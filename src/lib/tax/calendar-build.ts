// Assemble tax calendar rows from catalog + owner settings + mark-as-done rows.

import { csvCell } from "../books/registers";
import {
  TAX_CALENDAR_APPLIES,
  TAX_CALENDAR_STATUS,
  TAX_CALENDAR_UPCOMING_DAYS,
  type TaxCalendarAppliesKey,
  type TaxCalendarStatusKey,
} from "./calendar-constants";
import {
  addDaysYmd,
  generateOccurrences,
  manilaTodayYmd,
  statusForDueDate,
  type GeneratedOccurrence,
  type OwnerDueOverrides,
} from "./calendar-dates";
import {
  TAX_CALENDAR_OBLIGATIONS,
  defaultTaxCalendarSettings,
  type ObligationSettingsRow,
  type TaxCalendarObligationKey,
  type TaxCalendarSettingsShape,
} from "./calendar-obligations";

export type { ObligationSettingsRow, TaxCalendarSettingsShape };
export { defaultTaxCalendarSettings };

export type CompletionRow = {
  occurrenceKey: string;
  doneDateYmd: string;
  note: string | null;
};

export type TaxCalendarRow = {
  obligationKey: TaxCalendarObligationKey;
  occurrenceKey: string;
  periodKey: string;
  form: string;
  description: string;
  periodLabel: string;
  dueYmd: string | null;
  dueDisplay: string;
  fallsOnWeekend: boolean;
  fileByYmd: string | null;
  fileByHint: string | null;
  status: TaxCalendarStatusKey;
  statusLabel: string;
  applies: TaxCalendarAppliesKey;
  appliesLabel: string;
  appliesNote: string | null;
  sourceNote: string;
  worksheetHref: string | null;
  /** Worksheet link with period query when possible. */
  worksheetLink: string | null;
  greyedOut: boolean;
  enabled: boolean;
  markedDone: boolean;
  doneDateYmd: string | null;
  doneNote: string | null;
};

export type BuildCalendarInput = {
  settings: TaxCalendarSettingsShape;
  completions?: readonly CompletionRow[];
  /** Inclusive generation window (calendar years). */
  fromYear?: number;
  toYear?: number;
  now?: Date;
  /**
   * `upcoming` = due within next 90 days (or overdue / undated year for current year),
   * or marked done in that window.
   * `all` = every generated occurrence for enabled (and always-shown greyed) obligations.
   */
  view?: "upcoming" | "all";
};

function worksheetLinkFor(
  href: string | null,
  occurrence: GeneratedOccurrence,
): string | null {
  if (!href) return null;
  // 1701Q / quarterly worksheets take year+quarter.
  const qMatch = /^(\d{4})-Q([1-4])$/.exec(occurrence.periodKey);
  if (qMatch) return `${href}?year=${qMatch[1]}&quarter=${qMatch[2]}`;
  const yMatch = /^(\d{4})$/.exec(occurrence.periodKey);
  if (yMatch) return `${href}?year=${yMatch[1]}`;
  const tyMatch = /^TY(\d{4})$/.exec(occurrence.periodKey);
  if (tyMatch) return `${href}?year=${tyMatch[1]}`;
  return href;
}

function overrideFor(
  settings: TaxCalendarSettingsShape,
  key: TaxCalendarObligationKey,
): OwnerDueOverrides {
  const row = settings.obligations[key];
  return { dueDay: row?.dueDay ?? null, dueMonth: row?.dueMonth ?? null };
}

function isEnabled(settings: TaxCalendarSettingsShape, key: TaxCalendarObligationKey): boolean {
  return settings.obligations[key]?.enabled ?? false;
}

/**
 * Build sorted calendar rows for the UI / ICS / CSV.
 * Hidden (disabled) obligations are omitted — except we still omit them entirely
 * when disabled; greyed "does not apply" items stay visible when enabled (default on).
 */
export function buildTaxCalendarRows(input: BuildCalendarInput): TaxCalendarRow[] {
  const now = input.now ?? new Date();
  const today = manilaTodayYmd(now);
  const thisYear = Number(today.slice(0, 4));
  const fromYear = input.fromYear ?? thisYear - 1;
  const toYear = input.toYear ?? thisYear + 1;
  const view = input.view ?? "upcoming";
  const horizonEnd = addDaysYmd(today, TAX_CALENDAR_UPCOMING_DAYS);
  const doneMap = new Map((input.completions ?? []).map((c) => [c.occurrenceKey, c]));

  const rows: TaxCalendarRow[] = [];

  for (const def of TAX_CALENDAR_OBLIGATIONS) {
    if (!isEnabled(input.settings, def.key)) continue;
    const occurrences = generateOccurrences(def.key, fromYear, toYear, overrideFor(input.settings, def.key));
    for (const occ of occurrences) {
      const done = doneMap.get(occ.occurrenceKey);
      const markedDone = !!done;
      const status = statusForDueDate(occ.dueYmd, today, markedDone);

      if (view === "upcoming") {
        // Undated year-end: show the current Manila year only.
        if (!occ.dueYmd) {
          if (occ.periodKey !== String(thisYear) && !markedDone) continue;
        } else if (!markedDone) {
          // Include overdue + due within 90 days.
          if (occ.dueYmd > horizonEnd) continue;
          // Drop very old overdue (before fromYear window already limited); keep overdue in window.
        } else {
          // Marked done: keep if done date or due date falls in horizon / recent year.
          const anchor = done?.doneDateYmd ?? occ.dueYmd;
          if (anchor && (anchor < `${thisYear - 1}-01-01` || anchor > horizonEnd)) continue;
        }
      }

      rows.push({
        obligationKey: def.key,
        occurrenceKey: occ.occurrenceKey,
        periodKey: occ.periodKey,
        form: def.form,
        description: def.description,
        periodLabel: occ.periodLabel,
        dueYmd: occ.dueYmd,
        dueDisplay: occ.dueDisplay,
        fallsOnWeekend: occ.fallsOnWeekend,
        fileByYmd: occ.fileByYmd,
        fileByHint: occ.fileByHint,
        status,
        statusLabel: TAX_CALENDAR_STATUS[status],
        applies: def.applies,
        appliesLabel: TAX_CALENDAR_APPLIES[def.applies],
        appliesNote: def.appliesNote,
        sourceNote: def.sourceNote,
        worksheetHref: def.worksheetHref,
        worksheetLink: worksheetLinkFor(def.worksheetHref, occ),
        greyedOut: def.greyedOut,
        enabled: true,
        markedDone,
        doneDateYmd: done?.doneDateYmd ?? null,
        doneNote: done?.note ?? null,
      });
    }
  }

  rows.sort((a, b) => {
    // Undated last among open items; then by due date; then form.
    if (a.dueYmd && b.dueYmd) {
      if (a.dueYmd !== b.dueYmd) return a.dueYmd.localeCompare(b.dueYmd);
    } else if (a.dueYmd && !b.dueYmd) return -1;
    else if (!a.dueYmd && b.dueYmd) return 1;
    return a.form.localeCompare(b.form) || a.periodLabel.localeCompare(b.periodLabel);
  });

  return rows;
}

/** CSV export for the calendar list (injection-safe via shared csvCell). */
export function taxCalendarToCsv(rows: readonly TaxCalendarRow[]): string {
  const header = [
    "Form",
    "Description",
    "Period",
    "Due date (PHT)",
    "Weekend hint",
    "Status",
    "Applies?",
    "Applies note",
    "Worksheet",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.form,
        r.description,
        r.periodLabel,
        r.dueDisplay,
        r.fileByHint ?? "",
        r.statusLabel,
        r.appliesLabel,
        r.appliesNote ?? "",
        r.worksheetLink ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
