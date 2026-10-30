// ₱3M non-VAT threshold meter: gross sales so far this tax year vs the limit in
// Settings → Tax year, with warnings at the two configured percentages.
//
// Gross sales = sum of non-voided Part 5 billing `amount` values (booklet totals),
// dated by `invoiceDate` in the tax year [Jan 1 00:00 PHT, Jan 1 next year).
// Withholding (2307) does not reduce gross; collections are not counted again.

import type { Settings } from "../settings/schema";
import { db } from "../db";
import { money } from "../documents/common";
import { addDays, manilaToday } from "../format";
import { fromScaled, toScaled } from "../quotes/calc";

/** Asia/Manila is UTC+8 all year (no daylight saving). */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface GrossSalesSource {
  /** Gross sales (₱, booklet billing totals, not voided) dated in [from, to). */
  grossSalesBetween(from: Date, to: Date): Promise<number>;
}

/**
 * Sum billing amount strings with exact cent math. Convert to number only here
 * (once) for the meter — never float-accumulate.
 */
export function sumGrossSalesAmounts(amounts: readonly string[]): number {
  let cents = 0n;
  for (const a of amounts) {
    cents += toScaled(a, 2);
  }
  if (cents <= 0n) return 0;
  return Number(fromScaled(cents, 2));
}

/** Live source: non-voided Billing.amount rows whose invoiceDate is in [from, to). */
export const billingsGrossSales: GrossSalesSource = {
  async grossSalesBetween(from, to) {
    const rows = await db.billing.findMany({
      where: {
        status: { not: "VOID" },
        invoiceDate: { gte: from, lt: to },
      },
      select: { amount: true },
    });
    return sumGrossSalesAmounts(rows.map((r) => money(r.amount)));
  },
};

/** Start of Jan 1 of `year` in Manila, as a UTC instant. */
export function taxYearStart(year: number): Date {
  return new Date(Date.UTC(year, 0, 1) - MANILA_OFFSET_MS);
}

/**
 * Upper bound for YTD queries against `@db.Date` invoiceDate values (stored as
 * 00:00 UTC of the calendar day). Caps at the start of the next Asia/Manila
 * calendar day so a billing dated "today" still counts before 08:00 PHT, when
 * `now` is still on the previous UTC calendar day.
 */
export function grossSalesYtdEnd(now: Date, taxYearEnd: Date): Date {
  const endOfCurrentPhtDay = addDays(manilaToday(now), 1);
  return endOfCurrentPhtDay < taxYearEnd ? endOfCurrentPhtDay : taxYearEnd;
}

/** Gross sales from Jan 1 of the tax year through the current PHT day (or the year's end). */
export async function getGrossSalesYtd(
  year: number,
  now: Date = new Date(),
  source: GrossSalesSource = billingsGrossSales,
): Promise<number> {
  const from = taxYearStart(year);
  const end = taxYearStart(year + 1);
  if (now <= from) return 0;
  const to = grossSalesYtdEnd(now, end);
  const total = await source.grossSalesBetween(from, to);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

export type NonVatLevel = "ok" | "first" | "second" | "over";

export type NonVatMeter = {
  year: number;
  used: number;
  limit: number;
  /** Exact share of the limit used, in percent (may exceed 100). */
  pct: number;
  /** For display: one decimal, rounded down so it never shows a warning % early. */
  pctLabel: string;
  /** Bar width, 0–100. */
  barPct: number;
  level: NonVatLevel;
  warnFirstPct: number;
  warnSecondPct: number;
};

/** Pure: turns gross sales and the tax-year settings into the meter shown in the sidebar. */
export function nonVatMeter(used: number, taxYear: Settings["taxYear"]): NonVatMeter {
  const { year, nonVatLimit: limit, warnFirstPct, warnSecondPct } = taxYear;
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const level: NonVatLevel = pct >= 100 ? "over" : pct >= warnSecondPct ? "second" : pct >= warnFirstPct ? "first" : "ok";
  return {
    year,
    used,
    limit,
    pct,
    pctLabel: `${(Math.floor(pct * 10) / 10).toFixed(1)}%`,
    barPct: Math.min(100, Math.max(0, pct)),
    level,
    warnFirstPct,
    warnSecondPct,
  };
}

export async function getNonVatMeter(
  taxYear: Settings["taxYear"],
  now: Date = new Date(),
  source: GrossSalesSource = billingsGrossSales,
): Promise<NonVatMeter> {
  return nonVatMeter(await getGrossSalesYtd(taxYear.year, now, source), taxYear);
}

export const NON_VAT_MESSAGES: Record<NonVatLevel, string | null> = {
  ok: null,
  first: "Getting close to the non-VAT limit.",
  second: "Almost at the non-VAT limit. Talk to the accountant.",
  over: "Over the non-VAT limit. Talk to the accountant now.",
};
