// Versioned settings. Every save creates a new SettingsVersion holding the full
// snapshot, so documents created under an older version can keep reading it.
//
// The logic is written against a tiny store interface so it can be tested
// without a database; src/lib/settings/index.ts wires it to Prisma.

import { redactPrintAccountNumbers } from "@/lib/print/account-number";
import { DEFAULT_SETTINGS } from "./defaults";
import { settingsSchema, settingsSections, type Settings, type SettingsKey } from "./schema";

export type SettingsVersionRecord = {
  id: string;
  version: number;
  data: Settings;
  changedKey: string | null;
  before: unknown;
  after: unknown;
  effectiveFrom: Date;
  createdById: string | null;
};

export type NewSettingsVersion = Omit<SettingsVersionRecord, "id" | "effectiveFrom">;

export interface SettingsStore {
  latest(): Promise<SettingsVersionRecord | null>;
  byId(id: string): Promise<SettingsVersionRecord | null>;
  create(input: NewSettingsVersion): Promise<SettingsVersionRecord>;
}

export type SettingsSnapshot = {
  versionId: string;
  version: number;
  effectiveFrom: Date;
  settings: Settings;
};

export class SettingsConflictError extends Error {
  constructor() {
    super("Settings were changed by someone else. Reload the page and try again.");
    this.name = "SettingsConflictError";
  }
}

function toSnapshot(v: SettingsVersionRecord): SettingsSnapshot {
  return {
    versionId: v.id,
    version: v.version,
    effectiveFrom: v.effectiveFrom,
    // Parse so older snapshots missing a newer section (or a newer numbering
    // format, e.g. receivingReport / billing) still get a full shape.
    settings: settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...v.data,
      numbering: { ...DEFAULT_SETTINGS.numbering, ...(v.data as Partial<Settings>).numbering },
      invoiceBooklet: { ...DEFAULT_SETTINGS.invoiceBooklet, ...(v.data as Partial<Settings>).invoiceBooklet },
      collections: { ...DEFAULT_SETTINGS.collections, ...(v.data as Partial<Settings>).collections },
      features: { ...DEFAULT_SETTINGS.features, ...(v.data as Partial<Settings>).features },
      company: { ...DEFAULT_SETTINGS.company, ...(v.data as Partial<Settings>).company },
      print: {
        ...DEFAULT_SETTINGS.print,
        ...(v.data as Partial<Settings>).print,
        banks: (v.data as Partial<Settings>).print?.banks ?? DEFAULT_SETTINGS.print.banks,
        eWallets: (v.data as Partial<Settings>).print?.eWallets ?? DEFAULT_SETTINGS.print.eWallets,
      },
    }),
  };
}

/** Current settings. Creates version 1 from seed defaults if the table is empty. */
export async function getSettingsSnapshot(store: SettingsStore): Promise<SettingsSnapshot> {
  const latest = await store.latest();
  if (latest) return toSnapshot(latest);
  const first = await store.create({
    version: 1,
    data: DEFAULT_SETTINGS,
    changedKey: null,
    before: null,
    after: null,
    createdById: null,
  });
  return toSnapshot(first);
}

/** A specific (possibly old) version, e.g. the one a document was created under. */
export async function getSettingsVersion(store: SettingsStore, versionId: string): Promise<SettingsSnapshot | null> {
  const v = await store.byId(versionId);
  return v ? toSnapshot(v) : null;
}

export type SaveSectionInput<K extends SettingsKey> = {
  key: K;
  value: unknown;
  userId: string;
  /** Version the user was looking at; a save on top of a newer version is rejected. */
  baseVersionId: string;
};

export type SaveSectionResult =
  | { ok: true; version: SettingsVersionRecord; changed: true }
  | { ok: true; version: SettingsVersionRecord; changed: false }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Validate and save one settings section as a new version.
 * Returns field errors for invalid input. No-op (no new version) if nothing changed.
 */
export async function saveSettingsSection<K extends SettingsKey>(
  store: SettingsStore,
  input: SaveSectionInput<K>,
): Promise<SaveSectionResult> {
  const parsed = settingsSections[input.key].safeParse(input.value);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "_";
      fieldErrors[path] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const current = await getSettingsSnapshot(store);
  if (current.versionId !== input.baseVersionId) throw new SettingsConflictError();

  const before = current.settings[input.key];
  const after = parsed.data;
  const latest = (await store.byId(current.versionId))!;
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { ok: true, version: latest, changed: false };
  }

  // Full receiving-account numbers must never appear in the change-log before/after
  // columns (they remain in the settings snapshot `data` so prints can use them).
  const beforeForLog = input.key === "print" ? redactPrintAccountNumbers(before) : before;
  const afterForLog = input.key === "print" ? redactPrintAccountNumbers(after) : after;

  const version = await store.create({
    version: current.version + 1,
    data: { ...current.settings, [input.key]: after },
    changedKey: input.key,
    before: beforeForLog,
    after: afterForLog,
    createdById: input.userId,
  });
  return { ok: true, version, changed: true };
}
