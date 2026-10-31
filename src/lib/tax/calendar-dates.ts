// Pure due-date, weekend/holiday, and status helpers for the tax calendar (PHT / Manila).
// RMC 65-2016: due dates that fall on a weekend or holiday move to the next working day.

import { addDays, isoDate, manilaToday } from "../format";
import {
  TAX_CALENDAR_DATE_TO_CONFIRM,
  TAX_CALENDAR_FILE_BY_PREFIX,
  TAX_CALENDAR_FILE_BY_SUFFIX,
  TAX_CALENDAR_STATUS,
  type TaxCalendarStatusKey,
} from "./calendar-constants";
import {
  obligationByKey,
  type ObligationSchedule,
  type TaxCalendarObligationKey,
} from "./calendar-obligations";
import { holidayYmdSet, type TaxHoliday } from "./holidays";

/** Manila weekday: 0=Sun … 6=Sat (UTC date of a Manila YMD stored as DATE). */
export function manilaWeekday(ymd: string): number {
  // DATE columns are UTC midnight of the Manila calendar day.
  return new Date(`${ymd}T12:00:00.000Z`).getUTCDay();
}

export function isWeekendYmd(ymd: string): boolean {
  const d = manilaWeekday(ymd);
  return d === 0 || d === 6;
}

export function isHolidayYmd(ymd: string, holidays: readonly TaxHoliday[] | ReadonlySet<string>): boolean {
  const set = holidays instanceof Set ? holidays : holidayYmdSet(holidays);
  return set.has(ymd);
}

/** True when the date is Sat/Sun or in the holiday set. */
export function isNonWorkingYmd(ymd: string, holidays: readonly TaxHoliday[] | ReadonlySet<string> = []): boolean {
  return isWeekendYmd(ymd) || isHolidayYmd(ymd, holidays);
}

export function addDaysYmd(ymd: string, days: number): string {
  return isoDate(addDays(new Date(`${ymd}T00:00:00.000Z`), days));
}

/**
 * Next working day on or after `ymd` (skip weekends + holidays).
 * RMC 65-2016 roll-forward for tax due dates.
 */
export function nextWorkingDay(ymd: string, holidays: readonly TaxHoliday[] | ReadonlySet<string> = []): string {
  const set = holidays instanceof Set ? holidays : holidayYmdSet(holidays);
  let cur = ymd;
  // Safety bound: never loop more than a year of calendar days.
  for (let i = 0; i < 366; i++) {
    if (!isNonWorkingYmd(cur, set)) return cur;
    cur = addDaysYmd(cur, 1);
  }
  return cur;
}

/**
 * Previous working day on or before `ymd` (skip weekends + holidays).
 * Used for the "File by … to be safe" hint (file a day early).
 */
export function previousWorkingDay(ymd: string, holidays: readonly TaxHoliday[] | ReadonlySet<string> = []): string {
  const set = holidays instanceof Set ? holidays : holidayYmdSet(holidays);
  let cur = ymd;
  for (let i = 0; i < 366; i++) {
    if (!isNonWorkingYmd(cur, set)) return cur;
    cur = addDaysYmd(cur, -1);
  }
  return cur;
}

/** Clamp day into the month (e.g. day 31 in April → 30). */
export function ymdOnOrLast(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(Math.max(1, day), last);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function lastDayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export type WorkingDayHint = {
  /** Catalog / statutory legal due date before weekend/holiday roll. */
  legalDueYmd: string;
  /** Effective due after RMC 65-2016 roll (same as legal when already a working day). */
  dueYmd: string;
  /** True when legal due fell on a weekend or holiday and was rolled. */
  rolled: boolean;
  /** Previous working day before the effective due (for the file-early hint). */
  fileByYmd: string | null;
  /** Staff-facing hint, or null when no roll was needed. */
  fileByHint: string | null;
};

/** @deprecated Use WorkingDayHint — kept for call sites that still say WeekendHint. */
export type WeekendHint = WorkingDayHint & {
  /** @deprecated Prefer `rolled`. True when legal fell on Sat/Sun (ignores holidays). */
  fallsOnWeekend: boolean;
};

/**
 * RMC 65-2016: move weekend/holiday dues to the next working day.
 * Keep the existing "File by … to be safe" hint whenever a roll happened
 * (hint date = previous working day before the effective due).
 */
export function workingDayRule(
  legalDueYmd: string,
  holidays: readonly TaxHoliday[] | ReadonlySet<string> = [],
): WorkingDayHint {
  const set = holidays instanceof Set ? holidays : holidayYmdSet(holidays);
  const dueYmd = nextWorkingDay(legalDueYmd, set);
  const rolled = dueYmd !== legalDueYmd;
  if (!rolled) {
    return { legalDueYmd, dueYmd, rolled: false, fileByYmd: null, fileByHint: null };
  }
  // File a day early: previous working day strictly before the effective due.
  const fileByYmd = previousWorkingDay(addDaysYmd(dueYmd, -1), set);
  return {
    legalDueYmd,
    dueYmd,
    rolled: true,
    fileByYmd,
    fileByHint: `${TAX_CALENDAR_FILE_BY_PREFIX}${fileByYmd}${TAX_CALENDAR_FILE_BY_SUFFIX}`,
  };
}

/** Weekend-only helper kept for older tests; prefers empty holiday set. */
export function weekendRule(legalDueYmd: string, holidays: readonly TaxHoliday[] = []): WeekendHint {
  const w = workingDayRule(legalDueYmd, holidays);
  return { ...w, fallsOnWeekend: isWeekendYmd(legalDueYmd) };
}

/**
 * Status bucket relative to Manila today.
 * Marked done is decided by the caller (completion row); this helper covers the rest.
 * Not-applicable rows must never be reported as overdue by the caller.
 */
export function statusForDueDate(
  dueYmd: string | null,
  todayYmd: string,
  markedDone: boolean,
): TaxCalendarStatusKey {
  if (markedDone) return "markedDone";
  if (!dueYmd) return "upcoming";
  if (dueYmd < todayYmd) return "overdue";
  const in2 = addDaysYmd(todayYmd, 2);
  const in7 = addDaysYmd(todayYmd, 7);
  if (dueYmd <= in2) return "dueIn2";
  if (dueYmd <= in7) return "dueIn7";
  return "upcoming";
}

export function statusLabel(key: TaxCalendarStatusKey): string {
  return TAX_CALENDAR_STATUS[key];
}

export type OwnerDueOverrides = {
  /** Day-of-month override (1–31); null/undefined → catalog default. */
  dueDay?: number | null;
  /** Month override (1–12) for annual / undated; null → catalog default / undated. */
  dueMonth?: number | null;
};

export type GeneratedOccurrence = {
  obligationKey: TaxCalendarObligationKey;
  /** Stable id for mark-as-done: `${key}|${periodKey}`. */
  occurrenceKey: string;
  periodKey: string;
  /** Plain period label, e.g. "Q1 2026", "2026-05", "TY 2025", "2026". */
  periodLabel: string;
  /** Effective due date YYYY-MM-DD after weekend/holiday roll, or null when undated. */
  dueYmd: string | null;
  /** Display string for the due column ("date to confirm" when null). */
  dueDisplay: string;
  legalDueYmd: string;
  rolled: boolean;
  fallsOnWeekend: boolean;
  fileByYmd: string | null;
  fileByHint: string | null;
};

function periodQuarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

/** Effective due day from catalog + owner override. */
function effectiveDueDay(schedule: ObligationSchedule, override?: OwnerDueOverrides): number | null {
  if (override?.dueDay != null) return override.dueDay;
  switch (schedule.kind) {
    case "quarterly_1701q":
    case "annual_1701":
    case "quarterly_after_end":
    case "monthly":
      return schedule.dueDay;
    case "days_after_quarter_end":
    case "quarterly_last_day_after":
    case "undated_year_end":
    case "books_of_accounts":
      return null;
  }
}

function effectiveDueMonth(schedule: ObligationSchedule, override?: OwnerDueOverrides): number | null {
  if (override?.dueMonth != null) return override.dueMonth;
  if (schedule.kind === "annual_1701") return schedule.dueMonth;
  return null;
}

export type GenerateOccurrencesOptions = {
  override?: OwnerDueOverrides;
  holidays?: readonly TaxHoliday[];
  /** Books of accounts type — required for dated books_accounts rows. */
  booksType?: "loose_leaf" | "computerized" | null;
};

/**
 * Generate occurrences for one obligation across [fromYear, toYear] inclusive
 * (calendar years used for filing windows). Pure — no DB.
 */
export function generateOccurrences(
  key: TaxCalendarObligationKey,
  fromYear: number,
  toYear: number,
  overrideOrOpts?: OwnerDueOverrides | GenerateOccurrencesOptions,
): GeneratedOccurrence[] {
  // Back-compat: third arg used to be OwnerDueOverrides only.
  const opts: GenerateOccurrencesOptions =
    overrideOrOpts && ("override" in overrideOrOpts || "holidays" in overrideOrOpts || "booksType" in overrideOrOpts)
      ? (overrideOrOpts as GenerateOccurrencesOptions)
      : { override: overrideOrOpts as OwnerDueOverrides | undefined };
  const override = opts.override;
  const holidays = opts.holidays ?? [];
  const booksType = opts.booksType ?? null;

  const def = obligationByKey(key);
  const schedule = def.schedule;
  const out: GeneratedOccurrence[] = [];

  const push = (periodKey: string, periodLabel: string, rawDueYmd: string | null) => {
    if (!rawDueYmd) {
      out.push({
        obligationKey: key,
        occurrenceKey: `${key}|${periodKey}`,
        periodKey,
        periodLabel,
        dueYmd: null,
        dueDisplay: TAX_CALENDAR_DATE_TO_CONFIRM,
        legalDueYmd: "",
        rolled: false,
        fallsOnWeekend: false,
        fileByYmd: null,
        fileByHint: null,
      });
      return;
    }
    const rule = workingDayRule(rawDueYmd, holidays);
    out.push({
      obligationKey: key,
      occurrenceKey: `${key}|${periodKey}`,
      periodKey,
      periodLabel,
      dueYmd: rule.dueYmd,
      dueDisplay: rule.dueYmd,
      legalDueYmd: rule.legalDueYmd,
      rolled: rule.rolled,
      fallsOnWeekend: isWeekendYmd(rawDueYmd),
      fileByYmd: rule.fileByYmd,
      fileByHint: rule.fileByHint,
    });
  };

  switch (schedule.kind) {
    case "quarterly_1701q": {
      // Q1 → May, Q2 → Aug, Q3 → Nov of the same year.
      const day = effectiveDueDay(schedule, override) ?? 15;
      const months: Record<1 | 2 | 3, number> = { 1: 5, 2: 8, 3: 11 };
      for (let year = fromYear; year <= toYear; year++) {
        for (const q of [1, 2, 3] as const) {
          push(`${year}-Q${q}`, periodQuarterLabel(year, q), ymdOnOrLast(year, months[q], day));
        }
      }
      break;
    }
    case "annual_1701": {
      // For tax year Y, due Apr 15 of Y+1.
      const day = effectiveDueDay(schedule, override) ?? 15;
      const month = effectiveDueMonth(schedule, override) ?? 4;
      for (let taxYear = fromYear - 1; taxYear <= toYear; taxYear++) {
        const dueYear = taxYear + 1;
        if (dueYear < fromYear || dueYear > toYear + 1) continue;
        push(`TY${taxYear}`, `TY ${taxYear}`, ymdOnOrLast(dueYear, month, day));
      }
      break;
    }
    case "quarterly_after_end": {
      const day = effectiveDueDay(schedule, override) ?? schedule.dueDay;
      for (let year = fromYear; year <= toYear; year++) {
        for (const q of [1, 2, 3, 4] as const) {
          const endMonth = q * 3; // 3,6,9,12
          let dueMonth = endMonth + schedule.monthsAfterQuarterEnd;
          let dueYear = year;
          while (dueMonth > 12) {
            dueMonth -= 12;
            dueYear += 1;
          }
          push(`${year}-Q${q}`, periodQuarterLabel(year, q), ymdOnOrLast(dueYear, dueMonth, day));
        }
      }
      break;
    }
    case "days_after_quarter_end": {
      // e.g. 2551Q under Graduated: 25 days after quarter end.
      for (let year = fromYear; year <= toYear; year++) {
        for (const q of [1, 2, 3, 4] as const) {
          const endMonth = q * 3;
          const endYmd = lastDayOfMonth(year, endMonth);
          const raw =
            override?.dueDay != null
              ? (() => {
                  let dueMonth = endMonth + 1;
                  let dueYear = year;
                  if (dueMonth > 12) {
                    dueMonth -= 12;
                    dueYear += 1;
                  }
                  return ymdOnOrLast(dueYear, dueMonth, override.dueDay);
                })()
              : addDaysYmd(endYmd, schedule.daysAfter);
          push(`${year}-Q${q}`, periodQuarterLabel(year, q), raw);
        }
      }
      break;
    }
    case "monthly": {
      const day = effectiveDueDay(schedule, override) ?? schedule.dueDay;
      for (let year = fromYear; year <= toYear; year++) {
        for (let month = 1; month <= 12; month++) {
          const ym = `${year}-${String(month).padStart(2, "0")}`;
          push(ym, ym, ymdOnOrLast(year, month, day));
        }
      }
      break;
    }
    case "quarterly_last_day_after": {
      for (let year = fromYear; year <= toYear; year++) {
        for (const q of [1, 2, 3, 4] as const) {
          const endMonth = q * 3;
          let dueMonth = endMonth + schedule.monthsAfterQuarterEnd;
          let dueYear = year;
          while (dueMonth > 12) {
            dueMonth -= 12;
            dueYear += 1;
          }
          const dueYmd =
            override?.dueDay != null
              ? ymdOnOrLast(dueYear, dueMonth, override.dueDay)
              : lastDayOfMonth(dueYear, dueMonth);
          push(`${year}-Q${q}`, periodQuarterLabel(year, q), dueYmd);
        }
      }
      break;
    }
    case "undated_year_end": {
      const month = override?.dueMonth ?? null;
      const day = override?.dueDay ?? null;
      for (let year = fromYear; year <= toYear; year++) {
        const dueYmd = month != null && day != null ? ymdOnOrLast(year, month, day) : null;
        push(String(year), String(year), dueYmd);
      }
      break;
    }
    case "books_of_accounts": {
      // Jan 15 loose-leaf / Jan 30 computerized, else "date to confirm".
      for (let year = fromYear; year <= toYear; year++) {
        let raw: string | null = null;
        if (booksType === "loose_leaf") {
          raw = ymdOnOrLast(year, 1, schedule.looseLeafDay);
        } else if (booksType === "computerized") {
          raw = ymdOnOrLast(year, 1, schedule.computerizedDay);
        } else if (override?.dueMonth != null && override?.dueDay != null) {
          raw = ymdOnOrLast(year, override.dueMonth, override.dueDay);
        }
        push(String(year), String(year), raw);
      }
      break;
    }
  }

  return out;
}

/** Manila today as YYYY-MM-DD. */
export function manilaTodayYmd(now: Date = new Date()): string {
  return isoDate(manilaToday(now));
}
