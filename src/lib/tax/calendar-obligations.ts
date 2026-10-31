// Editable seed catalog for tax calendar obligations.
// Visibility and due dates also depend on Settings → Tax year
// (income tax method, holidays, books type) and non-VAT status.

import {
  TAX_CALENDAR_2550Q_NOTE,
  TAX_CALENDAR_2551Q_NOTE,
  TAX_CALENDAR_APPLIES,
  TAX_CALENDAR_BOOKS_SOURCE_NOTE,
  TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE,
  TAX_CALENDAR_PLAIN_NAMES,
  TAX_CALENDAR_WITHHOLDING_SOURCE_NOTE,
  type TaxCalendarAppliesKey,
} from "./calendar-constants";

export const TAX_CALENDAR_OBLIGATION_KEYS = [
  "1701q",
  "1701",
  "1701a",
  "2551q",
  "2550q",
  "0619e",
  "1601eq",
  "books_accounts",
  "inventory_list",
] as const;

export type TaxCalendarObligationKey = (typeof TAX_CALENDAR_OBLIGATION_KEYS)[number];

export function isTaxCalendarObligationKey(k: string): k is TaxCalendarObligationKey {
  return (TAX_CALENDAR_OBLIGATION_KEYS as readonly string[]).includes(k);
}

/**
 * How occurrences are generated. Due day (1–31) is overridable in settings
 * except where the catalog uses last-day-of-month, days-after, or undated.
 */
export type ObligationSchedule =
  | {
      /** 1701Q: Q1→May, Q2→Aug, Q3→Nov (no Q4 — annual return). */
      kind: "quarterly_1701q";
      dueDay: number;
    }
  | {
      /** Annual income tax: Apr 15 of the year after the tax year. */
      kind: "annual_1701";
      dueMonth: number;
      dueDay: number;
    }
  | {
      /** Quarterly forms due on a fixed day N months after quarter end. */
      kind: "quarterly_after_end";
      monthsAfterQuarterEnd: number;
      dueDay: number;
    }
  | {
      /** Quarterly forms due N calendar days after quarter end (e.g. 2551Q = 25). */
      kind: "days_after_quarter_end";
      daysAfter: number;
    }
  | {
      /** 0619-E: monthly on the Nth. */
      kind: "monthly";
      dueDay: number;
    }
  | {
      /** 1601-EQ: last day of the month after each quarter. */
      kind: "quarterly_last_day_after";
      monthsAfterQuarterEnd: number;
    }
  | {
      /** Year-end inventory — no date until owner confirms. */
      kind: "undated_year_end";
    }
  | {
      /** Books of accounts: Jan 15 loose-leaf / Jan 30 computerized. */
      kind: "books_of_accounts";
      looseLeafDay: number;
      computerizedDay: number;
    };

export type TaxCalendarObligationDef = {
  key: TaxCalendarObligationKey;
  /** Form code shown in the first column. */
  form: string;
  /** Plain name under the form code (or longer description when no plain name). */
  description: string;
  /** Default on/off. Withholding items start off (hidden). */
  defaultEnabled: boolean;
  applies: TaxCalendarAppliesKey;
  /** Extra note under Applies? (e.g. 2551Q / 2550Q). */
  appliesNote: string | null;
  /** Source note for accountant review. */
  sourceNote: string;
  schedule: ObligationSchedule;
  /** Link to matching worksheet, when one exists. */
  worksheetHref: string | null;
  /** Grey out / treat as does-not-apply when shown via the N/A toggle. */
  greyedOut: boolean;
};

/**
 * Seed obligations. Do NOT include 0605 (annual registration fee abolished).
 * Method-specific visibility (8% vs Graduated, non-VAT) is applied in calendar-build.
 */
export const TAX_CALENDAR_OBLIGATIONS: readonly TaxCalendarObligationDef[] = [
  {
    key: "1701q",
    form: "1701Q",
    description: TAX_CALENDAR_PLAIN_NAMES["1701Q"] ?? "Quarterly income tax",
    defaultEnabled: true,
    applies: "confirmed",
    appliesNote: null,
    sourceNote: TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE,
    schedule: { kind: "quarterly_1701q", dueDay: 15 },
    worksheetHref: "/books/tax/income",
    greyedOut: false,
  },
  {
    key: "1701a",
    form: "1701A",
    description: TAX_CALENDAR_PLAIN_NAMES["1701A"] ?? "Annual income tax",
    defaultEnabled: true,
    applies: "confirmed",
    appliesNote: null,
    sourceNote: TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE,
    schedule: { kind: "annual_1701", dueMonth: 4, dueDay: 15 },
    worksheetHref: null,
    greyedOut: false,
  },
  {
    key: "1701",
    form: "1701",
    description: "Annual income tax",
    defaultEnabled: true,
    applies: "confirmed",
    // Under Graduated, both 1701 and 1701A are options — do not invent other rules.
    appliesNote: "Under Graduated: 1701 or 1701A (confirm which with your accountant)",
    sourceNote: TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE,
    schedule: { kind: "annual_1701", dueMonth: 4, dueDay: 15 },
    worksheetHref: null,
    greyedOut: false,
  },
  {
    key: "2551q",
    form: "2551Q",
    description: TAX_CALENDAR_PLAIN_NAMES["2551Q"] ?? "Quarterly percentage tax (3%)",
    defaultEnabled: true,
    applies: "does_not_apply",
    appliesNote: TAX_CALENDAR_2551Q_NOTE,
    sourceNote: TAX_CALENDAR_2551Q_NOTE,
    // Graduated: 25 days after quarter end (rolled to next working day).
    schedule: { kind: "days_after_quarter_end", daysAfter: 25 },
    worksheetHref: null,
    greyedOut: true,
  },
  {
    key: "2550q",
    form: "2550Q",
    description: "Quarterly VAT return",
    defaultEnabled: true,
    applies: "does_not_apply",
    appliesNote: TAX_CALENDAR_2550Q_NOTE,
    sourceNote: TAX_CALENDAR_2550Q_NOTE,
    schedule: { kind: "quarterly_after_end", monthsAfterQuarterEnd: 1, dueDay: 25 },
    worksheetHref: null,
    greyedOut: true,
  },
  {
    key: "0619e",
    form: "0619-E",
    description: "Monthly remittance of expanded withholding tax",
    defaultEnabled: false,
    applies: "unverified",
    appliesNote: null,
    sourceNote: TAX_CALENDAR_WITHHOLDING_SOURCE_NOTE,
    schedule: { kind: "monthly", dueDay: 10 },
    worksheetHref: "/books/tax/ewt-withheld",
    greyedOut: false,
  },
  {
    key: "1601eq",
    form: "1601-EQ",
    description: "Quarterly expanded withholding tax return",
    defaultEnabled: false,
    applies: "unverified",
    appliesNote: null,
    sourceNote: TAX_CALENDAR_WITHHOLDING_SOURCE_NOTE,
    schedule: { kind: "quarterly_last_day_after", monthsAfterQuarterEnd: 1 },
    worksheetHref: "/books/tax/ewt-withheld",
    greyedOut: false,
  },
  {
    key: "books_accounts",
    form: "Books of accounts",
    description: "Year-end books of accounts",
    defaultEnabled: true,
    applies: "unverified",
    appliesNote: null,
    sourceNote: TAX_CALENDAR_BOOKS_SOURCE_NOTE,
    schedule: { kind: "books_of_accounts", looseLeafDay: 15, computerizedDay: 30 },
    worksheetHref: null,
    greyedOut: false,
  },
  {
    key: "inventory_list",
    form: "Inventory list",
    description: "Year-end inventory list",
    defaultEnabled: true,
    applies: "unverified",
    appliesNote: null,
    sourceNote: "Date left blank until confirmed.",
    schedule: { kind: "undated_year_end" },
    worksheetHref: null,
    greyedOut: false,
  },
] as const;

export function obligationByKey(key: TaxCalendarObligationKey): TaxCalendarObligationDef {
  const def = TAX_CALENDAR_OBLIGATIONS.find((o) => o.key === key);
  if (!def) throw new Error(`Unknown tax calendar obligation: ${key}`);
  return def;
}

/** Due month is editable only for annual income-tax returns (1701 / 1701A). */
export function obligationUsesDueMonth(def: TaxCalendarObligationDef): boolean {
  return def.schedule.kind === "annual_1701";
}

/** Short due-day hint for Settings → Tax calendar (one line). */
export function obligationDueDayHint(def: TaxCalendarObligationDef): string {
  switch (def.schedule.kind) {
    case "undated_year_end":
      return "Leave blank for date to confirm. Set day once RDO confirms.";
    case "quarterly_last_day_after":
      return "Leave blank to use the last day of the month after the quarter.";
    case "days_after_quarter_end":
      return `Leave blank to use ${def.schedule.daysAfter} days after quarter end.`;
    case "books_of_accounts":
      return "Leave blank; day follows books type (Jan 15 or Jan 30).";
    default:
      return "Day of the month (1–31).";
  }
}

/** Human Applies? label from key (empty string for unverified — not shown on rows). */
export function appliesLabel(key: TaxCalendarAppliesKey): string {
  return TAX_CALENDAR_APPLIES[key];
}

export type ObligationSettingsRow = {
  enabled: boolean;
  dueDay: number | null;
  dueMonth: number | null;
};

export type TaxCalendarSettingsShape = {
  corUploadedAndChecked: boolean;
  obligations: Record<TaxCalendarObligationKey, ObligationSettingsRow>;
};

/** Default settings shape from the catalog (Settings.taxCalendar seed). */
export function defaultTaxCalendarSettings(): TaxCalendarSettingsShape {
  const obligations = {} as TaxCalendarSettingsShape["obligations"];
  for (const def of TAX_CALENDAR_OBLIGATIONS) {
    let dueDay: number | null = null;
    let dueMonth: number | null = null;
    switch (def.schedule.kind) {
      case "quarterly_1701q":
      case "quarterly_after_end":
      case "monthly":
        dueDay = def.schedule.dueDay;
        break;
      case "annual_1701":
        dueDay = def.schedule.dueDay;
        dueMonth = def.schedule.dueMonth;
        break;
      case "days_after_quarter_end":
        dueDay = null;
        dueMonth = null;
        break;
      case "books_of_accounts":
      case "quarterly_last_day_after":
      case "undated_year_end":
        dueDay = null;
        dueMonth = null;
        break;
    }
    obligations[def.key] = {
      enabled: def.defaultEnabled,
      dueDay,
      dueMonth,
    };
  }
  return { corUploadedAndChecked: false, obligations };
}
