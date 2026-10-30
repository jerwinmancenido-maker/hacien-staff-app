// Editable seed catalog for Part 7d tax calendar obligations.
// Every entry is tagged UNVERIFIED with a source note. Defaults live here;
// owner overrides (enabled / due day) live in Settings.taxCalendar.

import {
  TAX_CALENDAR_2550Q_NOTE,
  TAX_CALENDAR_2551Q_NOTE,
  TAX_CALENDAR_APPLIES,
  TAX_CALENDAR_BOOKS_SOURCE_NOTE,
  TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE,
  TAX_CALENDAR_WITHHOLDING_SOURCE_NOTE,
  type TaxCalendarAppliesKey,
} from "./calendar-constants";

export const TAX_CALENDAR_OBLIGATION_KEYS = [
  "1701q",
  "1701",
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
 * except where the catalog uses last-day-of-month or undated.
 */
export type ObligationSchedule =
  | {
      /** 1701Q under 8% option: Q1→May, Q2→Aug, Q3→Nov (no Q4 — annual 1701). */
      kind: "quarterly_1701q";
      dueDay: number;
    }
  | {
      /** 1701 annual: Apr 15 of the year after the tax year. */
      kind: "annual_1701";
      dueMonth: number;
      dueDay: number;
    }
  | {
      /** Quarterly forms that still appear (often Does not apply) — due day after quarter end month. */
      kind: "quarterly_after_end";
      /** Months after quarter end when due (0 = end month of quarter). */
      monthsAfterQuarterEnd: number;
      dueDay: number;
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
      /** Year-end books / inventory — no date until owner confirms. */
      kind: "undated_year_end";
    };

export type TaxCalendarObligationDef = {
  key: TaxCalendarObligationKey;
  /** Form code shown in the first column. */
  form: string;
  /** Plain description. */
  description: string;
  /** Default on/off. Withholding items start off (hidden). */
  defaultEnabled: boolean;
  applies: TaxCalendarAppliesKey;
  /** Extra note under Applies? (e.g. 2551Q / 2550Q). */
  appliesNote: string | null;
  /** Source / UNVERIFIED note for accountant review. */
  sourceNote: string;
  schedule: ObligationSchedule;
  /** Link to matching 7c worksheet, when one exists. */
  worksheetHref: string | null;
  /** Grey out the row (Does not apply). */
  greyedOut: boolean;
};

/**
 * Seed obligations. Do NOT include 0605 (annual registration fee abolished).
 * All dates and applicability are UNVERIFIED pending COR / RDO.
 */
export const TAX_CALENDAR_OBLIGATIONS: readonly TaxCalendarObligationDef[] = [
  {
    key: "1701q",
    form: "1701Q",
    description: "Quarterly income tax return (8% option)",
    defaultEnabled: true,
    applies: "confirmed",
    appliesNote: null,
    sourceNote: TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE,
    schedule: { kind: "quarterly_1701q", dueDay: 15 },
    worksheetHref: "/books/tax/income",
    greyedOut: false,
  },
  {
    key: "1701",
    form: "1701",
    description: "Annual income tax return",
    defaultEnabled: true,
    applies: "confirmed",
    appliesNote: null,
    sourceNote: TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE,
    schedule: { kind: "annual_1701", dueMonth: 4, dueDay: 15 },
    worksheetHref: null,
    greyedOut: false,
  },
  {
    key: "2551q",
    form: "2551Q",
    description: "Quarterly percentage tax",
    defaultEnabled: true,
    applies: "does_not_apply",
    appliesNote: TAX_CALENDAR_2551Q_NOTE,
    sourceNote: `Does not apply under the 8% option — ${TAX_CALENDAR_2551Q_NOTE}. UNVERIFIED.`,
    // UNVERIFIED placeholder due: 15th of month after quarter end (common pattern; confirm with RDO).
    schedule: { kind: "quarterly_after_end", monthsAfterQuarterEnd: 1, dueDay: 15 },
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
    sourceNote: `Does not apply (non-VAT). ${TAX_CALENDAR_2550Q_NOTE} UNVERIFIED.`,
    // UNVERIFIED placeholder due: 25th of month after quarter end (common VAT pattern; confirm with RDO).
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
    schedule: { kind: "undated_year_end" },
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
    sourceNote: TAX_CALENDAR_BOOKS_SOURCE_NOTE,
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

/** Human Applies? label from key. */
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
