// Tax calendar — read deadlines + mark-as-done notes.
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
  buildTaxCalendarSections,
  defaultTaxCalendarSettings,
  missingHolidayYearsForWindow,
  missingHolidaysLine,
  type CompletionRow,
  type TaxCalendarRow,
  type TaxCalendarSettingsShape,
} from "../tax/calendar-build";
import type { BooksOfAccountsType, IncomeTaxMethod } from "../tax/calendar-constants";
import { ymdToDate, quarterBounds, type Quarter } from "../tax/quarters";
import {
  isTaxCalendarObligationKey,
  type TaxCalendarObligationKey,
} from "../tax/calendar-obligations";
import { normalizeHolidays, type TaxHoliday } from "../tax/holidays";

/** Drop stale 2551q.dueDay from older Settings snapshots (was 15 under old catalog). */
export function sanitizeTaxCalendarSettings(
  settings: TaxCalendarSettingsShape,
): TaxCalendarSettingsShape {
  const row = settings.obligations["2551q"];
  if (!row || row.dueDay == null) return settings;
  return {
    ...settings,
    obligations: {
      ...settings.obligations,
      "2551q": { ...row, dueDay: null, dueMonth: null },
    },
  };
}

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

/**
 * Period keys (`YYYY-Qn`) that have at least one customer 2307 (amount > 0)
 * on a POSTED collection in that quarter — used for the SAWT task.
 */
export async function quartersWithCustomer2307(
  fromYear: number,
  toYear: number,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let year = fromYear; year <= toYear; year++) {
    for (const q of [1, 2, 3, 4] as Quarter[]) {
      const b = quarterBounds(year, q);
      const hit = await db.withholding2307.findFirst({
        where: {
          amount: { gt: 0 },
          collection: {
            status: "POSTED",
            date: { gte: ymdToDate(b.fromYmd), lte: ymdToDate(b.toYmd) },
          },
        },
        select: { id: true },
      });
      if (hit) out.add(`${year}-Q${q}`);
    }
  }
  return out;
}

export type ListTaxCalendarResult = {
  rows: TaxCalendarRow[];
  overdue: TaxCalendarRow[];
  upcoming: TaxCalendarRow[];
  settings: TaxCalendarSettingsShape;
  provisional: boolean;
  showNotApplicable: boolean;
  holidays: TaxHoliday[];
  booksType: BooksOfAccountsType | null;
  incomeTaxMethod: IncomeTaxMethod;
  /** Calendar years in the window with no holiday entries (owner must enter). */
  missingHolidayYears: number[];
  /** One notice line listing missing years, or null when none. */
  missingHolidaysLine: string | null;
};

export async function listTaxCalendar(
  actor: PermissionUser,
  opts: {
    view?: "upcoming" | "all";
    now?: Date;
    showNotApplicable?: boolean;
  } = {},
): Promise<ListTaxCalendarResult> {
  assertCan(actor, "view_books");
  const snap = await getSettingsSnapshot();
  const settings = sanitizeTaxCalendarSettings(
    snap.settings.taxCalendar ?? defaultTaxCalendarSettings(),
  );
  const taxYear = snap.settings.taxYear;
  const completions = await loadActiveCompletions();
  const now = opts.now ?? new Date();
  const todayYmd = isoDate(manilaToday(now));
  const thisYear = Number(todayYmd.slice(0, 4));
  const fromYear = thisYear - 1;
  const toYear = thisYear + 1;
  const holidays = normalizeHolidays(taxYear.holidays ?? []);
  const missingHolidayYears = missingHolidayYearsForWindow(holidays, fromYear, toYear);
  const showNotApplicable = opts.showNotApplicable === true;
  const quartersWith2307 = await quartersWithCustomer2307(fromYear, toYear);

  const buildInput = {
    settings,
    completions,
    now,
    fromYear,
    toYear,
    holidays,
    incomeTax: {
      year: taxYear.year,
      incomeTaxMethod: taxYear.incomeTaxMethod,
      incomeTaxMethodsByYear: taxYear.incomeTaxMethodsByYear ?? {},
    },
    isNonVat: true, // HACIEN business setting: non-VAT
    booksType: taxYear.booksType ?? null,
    showNotApplicable,
    quartersWith2307,
  };

  const sections = buildTaxCalendarSections(buildInput);
  const view = opts.view ?? "upcoming";
  const rows =
    view === "all"
      ? sections.all
      : // Upcoming page: overdue section is separate; main list is the 90-day window.
        sections.upcoming;

  return {
    rows,
    overdue: view === "upcoming" ? sections.overdue : [],
    upcoming: sections.upcoming,
    settings,
    provisional: settings.corUploadedAndChecked !== true,
    showNotApplicable,
    holidays,
    booksType: taxYear.booksType ?? null,
    incomeTaxMethod: taxYear.incomeTaxMethod,
    missingHolidayYears,
    missingHolidaysLine: missingHolidaysLine(missingHolidayYears),
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

/** Re-export builder for ICS route convenience. */
export { buildTaxCalendarRows };
