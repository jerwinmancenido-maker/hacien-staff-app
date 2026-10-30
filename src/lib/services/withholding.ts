// Withholding rates (Settings → Withholding). The WithholdingRate table holds
// the current values. Each save also writes a new SettingsVersion (changedKey
// "withholding", with the changed rates before/after) and an AuditLog row in the
// same transaction, so rate changes show in the settings change log like any
// other setting. Rows are never deleted; they are turned off with `active`.
//
// Quotes don't point at these rows: they store a snapshot of the selected
// rates (code, label, line kind, rate), so editing a rate never changes an
// existing quote.

import type { WithholdingRate } from "@prisma/client";
import { db, type Db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { ratePctLabel, type WithholdingSnapshot } from "../quotes/calc";
import { prismaSettingsStore } from "../settings";
import { getSettingsSnapshot as snapshotFromStore, SettingsConflictError } from "../settings/service";
import { withholdingRatesSchema } from "../validation/withholding";

export const WITHHOLDING_SETTINGS_KEY = "withholding";

export function listWithholdingRates(client: Db | Tx = db, opts: { activeOnly?: boolean } = {}) {
  return client.withholdingRate.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
}

export function toSnapshot(r: Pick<WithholdingRate, "code" | "label" | "lineKind" | "rate" | "atcCode">): WithholdingSnapshot {
  return { code: r.code, label: r.label, lineKind: r.lineKind, rate: Number(r.rate).toFixed(4), atcCode: r.atcCode };
}

/** Parse a stored JSON code list (Customer.defaultWithholding). */
export function codeList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Parse a stored withholding snapshot (Quote/SalesOrder.withholding). */
export function snapshotList(value: unknown): WithholdingSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is WithholdingSnapshot =>
      !!v && typeof v === "object" && typeof (v as WithholdingSnapshot).code === "string" && typeof (v as WithholdingSnapshot).rate === "string",
  );
}

export class WithholdingRuleError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/**
 * The withholding snapshot for a document. Codes already on the document keep
 * their snapshotted values; newly picked codes take the current active rate.
 * Unknown or inactive new codes are rejected (or skipped, with `skipUnknown`,
 * when copying a customer's default).
 */
export function buildWithholdingSnapshot(
  codes: readonly string[],
  current: readonly Pick<WithholdingRate, "code" | "label" | "lineKind" | "rate" | "atcCode" | "active" | "sortOrder">[],
  existing: readonly WithholdingSnapshot[] = [],
  opts: { skipUnknown?: boolean } = {},
): WithholdingSnapshot[] {
  const out: WithholdingSnapshot[] = [];
  for (const code of new Set(codes)) {
    const kept = existing.find((e) => e.code === code);
    if (kept) {
      out.push(kept);
      continue;
    }
    const rate = current.find((r) => r.code === code && r.active);
    if (!rate) {
      if (opts.skipUnknown) continue;
      throw new WithholdingRuleError(`Withholding rate ${code} isn't available. Pick from the active rates.`, "withholding");
    }
    out.push(toSnapshot(rate));
  }
  // Show in the Settings order, then anything kept from an older snapshot.
  const order = (c: string) => current.find((r) => r.code === c)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return out.sort((a, b) => order(a.code) - order(b.code));
}

// ---------------------------------------------------------------------------
// Saving the Settings → Withholding table
// ---------------------------------------------------------------------------

type ChangeView = Record<string, { label: string; appliesTo: string; atcCode: string | null; rate: string; active: boolean; note: string | null }>;

function view(r: Pick<WithholdingRate, "code" | "label" | "lineKind" | "atcCode" | "rate" | "active" | "note">): ChangeView[string] {
  return { label: r.label, appliesTo: r.lineKind, atcCode: r.atcCode, rate: ratePctLabel(Number(r.rate).toFixed(4)), active: r.active, note: r.note };
}

export type SaveRatesResult =
  | { ok: true; changed: boolean; version: number }
  | { ok: false; fieldErrors: Record<string, string> };

export async function saveWithholdingRates(rawRows: unknown, userId: string, baseVersionId: string): Promise<SaveRatesResult> {
  const parsed = withholdingRatesSchema.safeParse(rawRows);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
    return { ok: false, fieldErrors };
  }
  const rows = parsed.data;

  return db.$transaction(async (tx) => {
    const settings = await snapshotFromStore(prismaSettingsStore(tx));
    if (settings.versionId !== baseVersionId) throw new SettingsConflictError();

    const existing = await tx.withholdingRate.findMany();
    const before: ChangeView = {};
    const after: ChangeView = {};

    for (const [i, row] of rows.entries()) {
      const data = { label: row.label, lineKind: row.lineKind, atcCode: row.atcCode, rate: row.ratePct, active: row.active, note: row.note, sortOrder: i + 1 };
      const old = row.id ? existing.find((e) => e.id === row.id) : undefined;
      if (row.id && !old) return { ok: false as const, fieldErrors: { [`${i}.code`]: "This rate no longer exists. Reload the page." } };
      if (old && old.code !== row.code) return { ok: false as const, fieldErrors: { [`${i}.code`]: "A code can't be changed once saved." } };
      if (!old && existing.some((e) => e.code === row.code)) return { ok: false as const, fieldErrors: { [`${i}.code`]: "Codes must be unique." } };

      if (!old) {
        const created = await tx.withholdingRate.create({ data: { code: row.code, ...data } });
        after[row.code] = view(created);
        continue;
      }
      const changed =
        old.label !== data.label ||
        old.lineKind !== data.lineKind ||
        old.atcCode !== data.atcCode ||
        Number(old.rate).toFixed(4) !== data.rate ||
        old.active !== data.active ||
        old.note !== data.note;
      if (changed) {
        const updated = await tx.withholdingRate.update({ where: { id: old.id }, data });
        before[row.code] = view(old);
        after[row.code] = view(updated);
      } else if (old.sortOrder !== data.sortOrder) {
        await tx.withholdingRate.update({ where: { id: old.id }, data: { sortOrder: data.sortOrder } });
      }
    }

    if (!Object.keys(after).length) return { ok: true as const, changed: false, version: settings.version };

    const version = await tx.settingsVersion.create({
      data: {
        version: settings.version + 1,
        data: settings.settings,
        changedKey: WITHHOLDING_SETTINGS_KEY,
        before,
        after,
        createdById: userId,
      },
    });
    await writeAudit(tx, {
      userId,
      entityType: "Settings",
      entityId: version.id,
      action: "settings_change",
      before: { [WITHHOLDING_SETTINGS_KEY]: before },
      after: { [WITHHOLDING_SETTINGS_KEY]: after },
      diff: false,
    });
    return { ok: true as const, changed: true, version: version.version };
  });
}
