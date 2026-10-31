// Tax calendar (Part 7d) — read deadlines + mark-as-done notes.
// Behind view_books + BOOKS_ENABLED (layout / callers enforce the flag).
// Never files, pays, or sends anything.

import { writeAudit } from "../audit";
import { db } from "../db";
import { DOC_TX, DocRuleError, withTxRetry } from "../documents/common";
import { isoDate, manilaToday } from "../format";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import {
  buildTaxCalendarRows,
  defaultTaxCalendarSettings,
  type CompletionRow,
  type TaxCalendarRow,
  type TaxCalendarSettingsShape,
} from "../tax/calendar-build";
import { ymdToDate } from "../tax/quarters";
import {
  isTaxCalendarObligationKey,
  type TaxCalendarObligationKey,
} from "../tax/calendar-obligations";

function parseOccurrenceKey(occurrenceKey: string): {
  obligationKey: TaxCalendarObligationKey;
  periodKey: string;
} {
  const pipe = occurrenceKey.indexOf("|");
  if (pipe <= 0) throw new DocRuleError("Unknown calendar item.", "occurrenceKey");
  const obligationKey = occurrenceKey.slice(0, pipe);
  const periodKey = occurrenceKey.slice(pipe + 1);
  if (!isTaxCalendarObligationKey(obligationKey) || !periodKey) {
    throw new DocRuleError("Unknown calendar item.", "occurrenceKey");
  }
  return { obligationKey, periodKey };
}

export async function loadTaxCalendarSettings(): Promise<TaxCalendarSettingsShape> {
  const snap = await getSettingsSnapshot();
  return snap.settings.taxCalendar ?? defaultTaxCalendarSettings();
}

async function loadActiveCompletions(): Promise<CompletionRow[]> {
  const rows = await db.taxCalendarCompletion.findMany({
    where: { undoneAt: null },
    select: { occurrenceKey: true, doneDate: true, note: true },
  });
  return rows.map((r) => ({
    occurrenceKey: r.occurrenceKey,
    doneDateYmd: isoDate(r.doneDate),
    note: r.note,
  }));
}

export async function listTaxCalendar(
  actor: PermissionUser,
  opts: { view?: "upcoming" | "all"; now?: Date } = {},
): Promise<{
  rows: TaxCalendarRow[];
  settings: TaxCalendarSettingsShape;
  provisional: boolean;
}> {
  assertCan(actor, "view_books");
  const settings = await loadTaxCalendarSettings();
  const completions = await loadActiveCompletions();
  const rows = buildTaxCalendarRows({
    settings,
    completions,
    view: opts.view ?? "upcoming",
    now: opts.now,
  });
  return {
    rows,
    settings,
    provisional: settings.corUploadedAndChecked !== true,
  };
}

/** Mark a calendar occurrence done (staff note only — not a filing). */
export async function markTaxCalendarDone(
  input: {
    occurrenceKey: string;
    doneDateYmd: string;
    note?: string | null;
    dueYmd?: string | null;
  },
  actor: PermissionUser & { id: string },
): Promise<{ id: string }> {
  assertCan(actor, "view_books");
  const { obligationKey, periodKey } = parseOccurrenceKey(input.occurrenceKey);
  const doneDateYmd = input.doneDateYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doneDateYmd)) {
    throw new DocRuleError("Enter the date you marked this done.", "doneDate");
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 2000) {
    throw new DocRuleError("Keep the note under 2000 characters.", "note");
  }

  return withTxRetry(async () =>
    db.$transaction(async (tx) => {
      const existing = await tx.taxCalendarCompletion.findFirst({
        where: { occurrenceKey: input.occurrenceKey, undoneAt: null },
      });
      if (existing) {
        throw new DocRuleError("This item is already marked done. Undo it first to change the note.");
      }

      const row = await tx.taxCalendarCompletion.create({
        data: {
          obligationKey,
          periodKey,
          occurrenceKey: input.occurrenceKey,
          dueDate: input.dueYmd ? ymdToDate(input.dueYmd) : null,
          doneDate: ymdToDate(doneDateYmd),
          note,
          createdById: actor.id,
        },
      });

      await writeAudit(tx, {
        userId: actor.id,
        entityType: "TaxCalendarCompletion",
        entityId: row.id,
        action: "create",
        before: null,
        after: {
          occurrenceKey: row.occurrenceKey,
          obligationKey: row.obligationKey,
          periodKey: row.periodKey,
          dueDate: input.dueYmd ?? null,
          doneDate: doneDateYmd,
          note,
          kind: "mark_done_note",
        },
      });

      return { id: row.id };
    }, DOC_TX),
  );
}

/** Undo a mark-as-done note (soft). */
export async function undoTaxCalendarDone(
  input: { occurrenceKey: string },
  actor: PermissionUser & { id: string },
): Promise<{ id: string }> {
  assertCan(actor, "view_books");
  parseOccurrenceKey(input.occurrenceKey);

  return withTxRetry(async () =>
    db.$transaction(async (tx) => {
      const existing = await tx.taxCalendarCompletion.findFirst({
        where: { occurrenceKey: input.occurrenceKey, undoneAt: null },
      });
      if (!existing) {
        throw new DocRuleError("Nothing to undo for this item.");
      }

      const row = await tx.taxCalendarCompletion.update({
        where: { id: existing.id },
        data: {
          undoneAt: new Date(),
          undoneById: actor.id,
        },
      });

      await writeAudit(tx, {
        userId: actor.id,
        entityType: "TaxCalendarCompletion",
        entityId: row.id,
        action: "update",
        before: {
          occurrenceKey: existing.occurrenceKey,
          doneDate: isoDate(existing.doneDate),
          note: existing.note,
          undoneAt: null,
        },
        after: {
          occurrenceKey: row.occurrenceKey,
          doneDate: isoDate(row.doneDate),
          note: row.note,
          undoneAt: row.undoneAt?.toISOString() ?? null,
          kind: "undo_mark_done",
        },
        diff: false,
      });

      return { id: row.id };
    }, DOC_TX),
  );
}

/** Default done date = Manila today. */
export function defaultDoneDateYmd(now: Date = new Date()): string {
  return isoDate(manilaToday(now));
}
