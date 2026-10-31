// Assemble tax calendar rows from catalog + owner settings + mark-as-done rows.

import { csvCell } from "../books/csv";
import {
  TAX_CALENDAR_APPLIES,
  TAX_CALENDAR_SAWT_TASK,
  TAX_CALENDAR_STATUS,
  TAX_CALENDAR_UPCOMING_DAYS,
  type BooksOfAccountsType,
  type IncomeTaxMethod,
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
import type { TaxHoliday } from "./holidays";
import { incomeTaxMethodForYear, isEightPercent, isGraduated } from "./income-tax-method";

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
  legalDueYmd: string;
  rolled: boolean;
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
  /** Extra staff tasks (e.g. SAWT when 2307s exist). */
  tasks: string[];
  /** True when this row is N/A (hidden by default; never overdue; no Mark as done). */
  notApplicable: boolean;
  /** Tax year used for method resolution (filing year or TY). */
  taxYearForMethod: number;
};

export type BuildCalendarInput = {
  settings: TaxCalendarSettingsShape;
  completions?: readonly CompletionRow[];
  /** Inclusive generation window (calendar years). */
  fromYear?: number;
  toYear?: number;
  now?: Date;
  /**
   * `upcoming` = due today..today+90 only (overdue is a separate section).
   * `overdue` = undone past-due applicable items.
   * `all` = every generated occurrence for enabled obligations (respecting N/A toggle).
   */
  view?: "upcoming" | "overdue" | "all";
  /** Holiday list from Settings → Tax year. */
  holidays?: readonly TaxHoliday[];
  /** Active tax-year settings used to resolve 8% vs Graduated per year. */
  incomeTax?: {
    year: number;
    incomeTaxMethod: IncomeTaxMethod;
    incomeTaxMethodsByYear: Record<string, IncomeTaxMethod>;
  };
  /** HACIEN is non-VAT — hide 2550Q unless showNotApplicable. */
  isNonVat?: boolean;
  /** Books of accounts type; null → "date to confirm". */
  booksType?: BooksOfAccountsType | null;
  /**
   * When false (default), hide does-not-apply rows.
   * When true, show them — never Overdue, no Mark as done.
   */
  showNotApplicable?: boolean;
  /**
   * Period keys (`2026-Q3`) that have at least one customer 2307 logged.
   * Adds the SAWT task on that quarter's 1701Q row.
   */
  quartersWith2307?: ReadonlySet<string> | readonly string[];
};

function worksheetLinkFor(
  href: string | null,
  occurrence: GeneratedOccurrence,
): string | null {
  if (!href) return null;
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

/** Tax year associated with an occurrence for method lookup. */
export function taxYearForOccurrence(obligationKey: TaxCalendarObligationKey, periodKey: string): number {
  const ty = /^TY(\d{4})$/.exec(periodKey);
  if (ty) return Number(ty[1]);
  const q = /^(\d{4})-Q[1-4]$/.exec(periodKey);
  if (q) return Number(q[1]);
  const y = /^(\d{4})$/.exec(periodKey);
  if (y) return Number(y[1]);
  const ym = /^(\d{4})-\d{2}$/.exec(periodKey);
  if (ym) return Number(ym[1]);
  return Number(periodKey.slice(0, 4)) || new Date().getUTCFullYear();
}

/**
 * Resolve whether a catalog row applies for a given tax year / VAT status.
 * Returns { include, notApplicable, applies }.
 */
function confirmedOrHidden(corUploadedAndChecked: boolean): TaxCalendarAppliesKey {
  // Never show "Unverified: ask RDO" on rows — hide the Applies chip until COR is checked.
  return corUploadedAndChecked ? "confirmed" : "unverified";
}

export function resolveApplicability(opts: {
  key: TaxCalendarObligationKey;
  catalogApplies: TaxCalendarAppliesKey;
  method: IncomeTaxMethod;
  isNonVat: boolean;
  corUploadedAndChecked: boolean;
}): { includeAlways: boolean; notApplicable: boolean; applies: TaxCalendarAppliesKey } {
  const { key, catalogApplies, method, isNonVat, corUploadedAndChecked } = opts;

  // 2550Q: non-VAT → does not apply (hidden by default).
  if (key === "2550q") {
    if (isNonVat) {
      return { includeAlways: false, notApplicable: true, applies: "does_not_apply" };
    }
    return {
      includeAlways: true,
      notApplicable: false,
      applies: confirmedOrHidden(corUploadedAndChecked),
    };
  }

  // 2551Q: hide under 8% (N/A); show under Graduated.
  if (key === "2551q") {
    if (isEightPercent(method)) {
      return { includeAlways: false, notApplicable: true, applies: "does_not_apply" };
    }
    return {
      includeAlways: true,
      notApplicable: false,
      applies: confirmedOrHidden(corUploadedAndChecked),
    };
  }

  // Annual return: 1701A under 8%; 1701 and 1701A under Graduated.
  if (key === "1701a") {
    return {
      includeAlways: true,
      notApplicable: false,
      applies: confirmedOrHidden(corUploadedAndChecked),
    };
  }
  if (key === "1701") {
    if (isEightPercent(method)) {
      // Under 8% the annual return is 1701A only — hide 1701.
      return { includeAlways: false, notApplicable: true, applies: "does_not_apply" };
    }
    return {
      includeAlways: true,
      notApplicable: false,
      applies: confirmedOrHidden(corUploadedAndChecked),
    };
  }

  let applies: TaxCalendarAppliesKey = catalogApplies;
  if (!corUploadedAndChecked && catalogApplies === "confirmed") {
    applies = "unverified";
  }

  return {
    includeAlways: catalogApplies !== "does_not_apply",
    notApplicable: catalogApplies === "does_not_apply",
    applies,
  };
}

function sortRows(rows: TaxCalendarRow[]): TaxCalendarRow[] {
  return rows.sort((a, b) => {
    const statusRank = (s: TaxCalendarStatusKey): number =>
      s === "overdue" ? 0 : s === "dueIn2" ? 1 : s === "dueIn7" ? 2 : s === "upcoming" ? 3 : 4;
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    if (a.dueYmd && b.dueYmd) {
      if (a.dueYmd !== b.dueYmd) return a.dueYmd.localeCompare(b.dueYmd);
    } else if (a.dueYmd && !b.dueYmd) return -1;
    else if (!a.dueYmd && b.dueYmd) return 1;
    return a.form.localeCompare(b.form) || a.periodLabel.localeCompare(b.periodLabel);
  });
}

/**
 * Build sorted calendar rows for the UI / ICS / CSV.
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
  const holidays = input.holidays ?? [];
  const isNonVat = input.isNonVat !== false; // HACIEN default: non-VAT
  const showNa = input.showNotApplicable === true;
  const booksType = input.booksType ?? null;
  const quartersWith2307 = new Set(
    input.quartersWith2307 instanceof Set
      ? [...input.quartersWith2307]
      : (input.quartersWith2307 ?? []),
  );
  const incomeTax = input.incomeTax ?? {
    year: thisYear,
    incomeTaxMethod: "EIGHT_PERCENT" as IncomeTaxMethod,
    incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" as IncomeTaxMethod },
  };

  const rows: TaxCalendarRow[] = [];

  for (const def of TAX_CALENDAR_OBLIGATIONS) {
    if (!isEnabled(input.settings, def.key)) continue;

    const occurrences = generateOccurrences(def.key, fromYear, toYear, {
      override: overrideFor(input.settings, def.key),
      holidays,
      booksType,
    });

    for (const occ of occurrences) {
      const taxYear = taxYearForOccurrence(def.key, occ.periodKey);
      const method = incomeTaxMethodForYear(incomeTax, taxYear);
      const appl = resolveApplicability({
        key: def.key,
        catalogApplies: def.applies,
        method,
        isNonVat,
        corUploadedAndChecked: input.settings.corUploadedAndChecked,
      });

      // Under Graduated, 2551Q applies — clear greyed/N/A catalog flags.
      const notApplicable = appl.notApplicable;
      if (notApplicable && !showNa) continue;
      if (!appl.includeAlways && !notApplicable) continue;

      const greyedOut = notApplicable;
      const applies: TaxCalendarAppliesKey = appl.applies;

      const done = doneMap.get(occ.occurrenceKey);
      const markedDone = !!done;
      // N/A rows are never Overdue.
      let status = statusForDueDate(occ.dueYmd, today, markedDone);
      if (notApplicable && status === "overdue") status = "upcoming";

      if (view === "upcoming") {
        // Strict window: today through today+90 inclusive. No overdue here.
        if (!occ.dueYmd) {
          if (occ.periodKey !== String(thisYear) && !markedDone) continue;
        } else if (markedDone) {
          const anchor = done?.doneDateYmd ?? occ.dueYmd;
          if (anchor < today || anchor > horizonEnd) continue;
        } else {
          if (occ.dueYmd < today || occ.dueYmd > horizonEnd) continue;
        }
      } else if (view === "overdue") {
        if (notApplicable) continue;
        if (markedDone) continue;
        if (!occ.dueYmd || occ.dueYmd >= today) continue;
      }

      const tasks: string[] = [];
      if (def.key === "1701q" && quartersWith2307.has(occ.periodKey)) {
        tasks.push(TAX_CALENDAR_SAWT_TASK);
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
        legalDueYmd: occ.legalDueYmd,
        rolled: occ.rolled,
        fallsOnWeekend: occ.fallsOnWeekend,
        fileByYmd: occ.fileByYmd,
        fileByHint: occ.fileByHint,
        status,
        statusLabel: TAX_CALENDAR_STATUS[status],
        applies,
        appliesLabel: TAX_CALENDAR_APPLIES[applies],
        appliesNote: notApplicable
          ? def.appliesNote
          : def.key === "1701" && isGraduated(method)
            ? def.appliesNote
            : def.key === "2551q" && isGraduated(method)
              ? null
              : def.appliesNote,
        sourceNote: def.sourceNote,
        worksheetHref: def.worksheetHref,
        worksheetLink: worksheetLinkFor(def.worksheetHref, occ),
        greyedOut: greyedOut || notApplicable,
        enabled: true,
        markedDone,
        doneDateYmd: done?.doneDateYmd ?? null,
        doneNote: done?.note ?? null,
        tasks,
        notApplicable,
        taxYearForMethod: taxYear,
      });
    }
  }

  return sortRows(rows);
}

/** Split helper for the calendar page: overdue section + next-90 section. */
export function buildTaxCalendarSections(input: Omit<BuildCalendarInput, "view">): {
  overdue: TaxCalendarRow[];
  upcoming: TaxCalendarRow[];
  all: TaxCalendarRow[];
} {
  return {
    overdue: buildTaxCalendarRows({ ...input, view: "overdue" }),
    upcoming: buildTaxCalendarRows({ ...input, view: "upcoming" }),
    all: buildTaxCalendarRows({ ...input, view: "all" }),
  };
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
    "Tasks",
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
        r.tasks.join("; "),
        r.worksheetLink ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
