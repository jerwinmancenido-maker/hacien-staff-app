// Tax calendar — read deadlines + mark-as-done notes.
// Behind view_books + BOOKS_ENABLED (layout / callers enforce the flag).
// Never files, pays, or sends anything.

import { writeAudit } from "../audit";
import { db } from "../db";
import { DOC_TX, DocRuleError, withTxRetry } from "../documents/common";
import { isoDate, manilaToday } from "../format";
import { assertCan, ForbiddenError, type PermissionUser } from "../permissions";
import {
  createAttachments,
  discardUploads,
  prepareUploads,
  type UploadFile,
} from "./attachments";
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

/** Drop only stale 2551q.dueDay === 15 from older Settings snapshots; keep dueMonth. */
export function sanitizeTaxCalendarSettings(
  settings: TaxCalendarSettingsShape,
): TaxCalendarSettingsShape {
  const row = settings.obligations["2551q"];
  if (!row || row.dueDay !== 15) return settings;
  return {
    ...settings,
    obligations: {
      ...settings.obligations,
      "2551q": { ...row, dueDay: null },
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
    select: {
      id: true,
      occurrenceKey: true,
      doneDate: true,
      note: true,
      referenceNo: true,
      attachments: {
        where: { archivedAt: null },
        select: { id: true, fileName: true },
        take: 1,
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    occurrenceKey: r.occurrenceKey,
    doneDateYmd: isoDate(r.doneDate),
    note: r.note,
    referenceNo: r.referenceNo,
    attachmentId: r.attachments[0]?.id ?? null,
    attachmentFileName: r.attachments[0]?.fileName ?? null,
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
      // Filed income-tax records (ref + confirmation) must use Admin undoTaxCalendarFiled
      // with a reason — never the note Undo path (view_books / no void history).
      if (existing.referenceNo?.trim()) {
        throw new DocRuleError(
          "This is a filed income tax record. An Admin must undo it with a reason (Home → Undo filed).",
        );
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

function assertCanManageFilings(actor: PermissionUser) {
  assertCan(actor, "view_books");
  if (!actor.active || !actor.isAdmin) {
    throw new ForbiddenError();
  }
}

export type MarkTaxCalendarFiledInput = {
  occurrenceKey: string;
  filedDateYmd: string;
  referenceNo: string;
  file: UploadFile;
  dueYmd?: string | null;
  note?: string | null;
};

/**
 * Record that an income tax return was filed (Admin only).
 * Requires date filed, BIR confirmation reference number, and confirmation file attachment.
 * The app never files or pays anything with BIR: this only records that staff filed externally.
 */
export async function markTaxCalendarFiled(
  input: MarkTaxCalendarFiledInput,
  actor: PermissionUser & { id: string },
): Promise<{ id: string }> {
  assertCanManageFilings(actor);
  const { obligationKey, periodKey } = parseOccurrenceKey(input.occurrenceKey);

  const filedDateYmd = input.filedDateYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedDateYmd)) {
    throw new DocRuleError("Enter the date you filed.", "filedDate");
  }

  const referenceNo = input.referenceNo.trim();
  if (!referenceNo) {
    throw new DocRuleError("Enter the BIR filing reference number.", "referenceNo");
  }

  if (!input.file || !input.file.bytes || input.file.bytes.length === 0) {
    throw new DocRuleError("Attach the eFPS or eBIRForms confirmation.", "file");
  }

  const note = input.note?.trim() || null;
  if (note && note.length > 2000) {
    throw new DocRuleError("Keep the note under 2000 characters.", "note");
  }

  const prepared = await prepareUploads([input.file]);

  try {
    return await withTxRetry(async () =>
      db.$transaction(async (tx) => {
        const existing = await tx.taxCalendarCompletion.findFirst({
          where: { occurrenceKey: input.occurrenceKey, undoneAt: null },
        });
        if (existing?.referenceNo?.trim()) {
          throw new DocRuleError("This item is already marked filed. Undo it first to change.");
        }
        // Staff "Mark as done" notes (no BIR ref) must not block Admin mark-filed.
        // Soft-void the note and keep it as history, then create the filing row.
        if (existing) {
          const now = new Date();
          await tx.taxCalendarCompletion.update({
            where: { id: existing.id },
            data: {
              undoneAt: now,
              undoneById: actor.id,
              voidedAt: now,
              voidReason: "Replaced by Admin income tax filing record",
            },
          });
          await writeAudit(tx, {
            userId: actor.id,
            entityType: "TaxCalendarCompletion",
            entityId: existing.id,
            action: "void",
            before: {
              occurrenceKey: existing.occurrenceKey,
              doneDate: isoDate(existing.doneDate),
              note: existing.note,
              referenceNo: existing.referenceNo,
            },
            after: {
              occurrenceKey: existing.occurrenceKey,
              kind: "replace_note_with_filed",
              voidReason: "Replaced by Admin income tax filing record",
            },
            diff: false,
          });
        }

        const row = await tx.taxCalendarCompletion.create({
          data: {
            obligationKey,
            periodKey,
            occurrenceKey: input.occurrenceKey,
            dueDate: input.dueYmd ? ymdToDate(input.dueYmd) : null,
            doneDate: ymdToDate(filedDateYmd),
            referenceNo,
            note,
            createdById: actor.id,
          },
        });

        await createAttachments(tx, prepared, { taxCalendarCompletionId: row.id }, actor.id);

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
            doneDate: filedDateYmd,
            referenceNo,
            note,
            attachmentFileName: prepared[0]?.fileName ?? input.file.name,
            kind: "mark_filed",
          },
        });

        return { id: row.id };
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(prepared);
    throw e;
  }
}

export type UndoTaxCalendarFiledInput = {
  occurrenceKey: string;
  reason: string;
};

/**
 * Undo a filed record (Admin only).
 * Requires a reason. Records are never deleted: kept with void history in audit log.
 */
export async function undoTaxCalendarFiled(
  input: UndoTaxCalendarFiledInput,
  actor: PermissionUser & { id: string },
): Promise<{ id: string }> {
  assertCanManageFilings(actor);
  parseOccurrenceKey(input.occurrenceKey);

  const reason = input.reason.trim();
  if (!reason) {
    throw new DocRuleError("Provide a reason for undoing this filing.", "reason");
  }

  return withTxRetry(async () =>
    db.$transaction(async (tx) => {
      const existing = await tx.taxCalendarCompletion.findFirst({
        where: { occurrenceKey: input.occurrenceKey, undoneAt: null },
      });
      if (!existing) {
        throw new DocRuleError("Nothing to undo for this item.");
      }

      const now = new Date();
      const row = await tx.taxCalendarCompletion.update({
        where: { id: existing.id },
        data: {
          undoneAt: now,
          undoneById: actor.id,
          voidedAt: now,
          voidReason: reason,
        },
      });

      await writeAudit(tx, {
        userId: actor.id,
        entityType: "TaxCalendarCompletion",
        entityId: row.id,
        action: "void",
        before: {
          occurrenceKey: existing.occurrenceKey,
          doneDate: isoDate(existing.doneDate),
          referenceNo: existing.referenceNo,
          undoneAt: null,
          voidedAt: null,
        },
        after: {
          occurrenceKey: row.occurrenceKey,
          doneDate: isoDate(row.doneDate),
          referenceNo: row.referenceNo,
          undoneAt: row.undoneAt?.toISOString() ?? null,
          voidedAt: row.voidedAt?.toISOString() ?? null,
          reason,
          kind: "undo_filed",
        },
        diff: false,
      });

      return { id: row.id };
    }, DOC_TX),
  );
}

/**
 * Home / income-tax "filed" means Admin recorded a BIR reference (and confirmation file).
 * A calendar "Mark as done" note alone is not a filing.
 */
export function isIncomeTaxFiled(row: {
  markedDone?: boolean;
  referenceNo?: string | null;
}): boolean {
  return Boolean(row.markedDone && row.referenceNo?.trim());
}

/**
 * Select the single next filing occurrence for an obligation (e.g. 1701Q or 1701A).
 * 1. An unfiled occurrence whose due date is in the past (overdue) takes top priority.
 * 2. Otherwise, the earliest occurrence whose due date is today or later (upcoming cycle).
 * 3. Fallback to the latest occurrence.
 */
export function selectNextFiling(
  rows: readonly TaxCalendarRow[],
  obligationKey: "1701q" | "1701a",
  todayYmd: string,
): TaxCalendarRow | null {
  const matching = rows.filter(
    (r) => r.obligationKey === obligationKey && r.applies !== "does_not_apply",
  );
  if (matching.length === 0) return null;

  // 1. Earliest unfiled overdue occurrence (staff notes without a ref are still unfiled)
  const unfiledOverdue = matching
    .filter((r) => !isIncomeTaxFiled(r) && r.dueYmd && r.dueYmd < todayYmd)
    .sort((a, b) => (a.dueYmd!).localeCompare(b.dueYmd!))[0];
  if (unfiledOverdue) return unfiledOverdue;

  // 2. Earliest upcoming occurrence (due today or in the future)
  const upcoming = matching
    .filter((r) => r.dueYmd && r.dueYmd >= todayYmd)
    .sort((a, b) => (a.dueYmd!).localeCompare(b.dueYmd!))[0];
  if (upcoming) return upcoming;

  // 3. Fallback to latest
  return matching[matching.length - 1] ?? null;
}

/**
 * Select the next 1701Q and next 1701A filings for the Home "Income tax filings" card.
 */
export function selectNextIncomeTaxFilings(
  rows: readonly TaxCalendarRow[],
  todayYmd: string,
): {
  q1701: TaxCalendarRow | null;
  a1701: TaxCalendarRow | null;
} {
  return {
    q1701: selectNextFiling(rows, "1701q", todayYmd),
    a1701: selectNextFiling(rows, "1701a", todayYmd),
  };
}

/** Re-export builder for ICS route convenience. */
export { buildTaxCalendarRows };
