// Calendar quarters in Asia/Manila (PHT). DATE columns use UTC midnight of the
// Manila day; cutoffs are inclusive on the last calendar day of the quarter.

import { isoDate, manilaToday } from "../format";

export type Quarter = 1 | 2 | 3 | 4;

export type TaxQuarter = {
  year: number;
  quarter: Quarter;
};

export type QuarterBounds = TaxQuarter & {
  /** Inclusive Manila YYYY-MM-DD — first day of the quarter. */
  fromYmd: string;
  /** Inclusive Manila YYYY-MM-DD — last day of the quarter. */
  toYmd: string;
  /** Inclusive Manila YYYY-MM-DD — Jan 1 of the year (cumulative start). */
  yearStartYmd: string;
  label: string;
};

const QUARTER_MONTHS: Record<Quarter, { startMonth: number; endMonth: number; endDay: number }> = {
  1: { startMonth: 1, endMonth: 3, endDay: 31 },
  2: { startMonth: 4, endMonth: 6, endDay: 30 },
  3: { startMonth: 7, endMonth: 9, endDay: 30 },
  4: { startMonth: 10, endMonth: 12, endDay: 31 },
};

export function isQuarter(n: number): n is Quarter {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

export function quarterLabel(year: number, quarter: Quarter): string {
  return `Q${quarter} ${year}`;
}

/** Inclusive Manila calendar bounds for a quarter. */
export function quarterBounds(year: number, quarter: Quarter): QuarterBounds {
  const m = QUARTER_MONTHS[quarter];
  const fromYmd = `${year}-${String(m.startMonth).padStart(2, "0")}-01`;
  const toYmd = `${year}-${String(m.endMonth).padStart(2, "0")}-${String(m.endDay).padStart(2, "0")}`;
  return {
    year,
    quarter,
    fromYmd,
    toYmd,
    yearStartYmd: `${year}-01-01`,
    label: quarterLabel(year, quarter),
  };
}

/**
 * Latest quarter whose last day is strictly before today's Manila calendar date.
 * Example: on 2026-10-30 PHT → Q3 2026; on 2026-01-05 → Q4 2025.
 */
export function latestFinishedQuarter(now: Date = new Date()): TaxQuarter {
  const today = isoDate(manilaToday(now));
  const [y, m] = today.split("-").map(Number) as [number, number];
  if (m >= 10) return { year: y, quarter: 3 };
  if (m >= 7) return { year: y, quarter: 2 };
  if (m >= 4) return { year: y, quarter: 1 };
  return { year: y - 1, quarter: 4 };
}

/** Parse ?year=&quarter=; invalid → latest finished quarter. */
export function parseTaxQuarter(
  yearRaw?: string | null,
  quarterRaw?: string | null,
  now: Date = new Date(),
): QuarterBounds & { isDefault: boolean } {
  const year = yearRaw ? Number(yearRaw) : NaN;
  const quarter = quarterRaw ? Number(quarterRaw) : NaN;
  if (Number.isInteger(year) && year >= 2000 && year <= 2100 && isQuarter(quarter)) {
    return { ...quarterBounds(year, quarter), isDefault: false };
  }
  const fin = latestFinishedQuarter(now);
  return { ...quarterBounds(fin.year, fin.quarter), isDefault: true };
}

/** Quarters 1..(q-1) of the same year (for “tax paid in earlier quarters”). */
export function earlierQuarters(quarter: Quarter): Quarter[] {
  const out: Quarter[] = [];
  for (let q = 1; q < quarter; q++) out.push(q as Quarter);
  return out;
}

/** Manila YYYY-MM-DD for the first/last day of a calendar month. */
export function monthBounds(year: number, month: number): { fromYmd: string; toYmd: string } {
  const fromYmd = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const toYmd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { fromYmd, toYmd };
}

/** Month number (1–12) that contains a Manila YYYY-MM-DD. */
export function monthOfYmd(ymd: string): number {
  return Number(ymd.slice(5, 7));
}

/** Which quarter contains a Manila YYYY-MM-DD (same year). */
export function quarterOfYmd(ymd: string): Quarter {
  const m = monthOfYmd(ymd);
  if (m <= 3) return 1;
  if (m <= 6) return 2;
  if (m <= 9) return 3;
  return 4;
}

/** UTC Date at midnight for a Manila YYYY-MM-DD (matches DATE column storage). */
export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}
