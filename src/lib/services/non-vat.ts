// ₱3M non-VAT threshold meter: gross sales so far this tax year vs the limit in
// Settings → Tax year, with warnings at the two configured percentages.
//
// Gross sales come from a pluggable source so the meter can be tested (and so
// Billing can plug in invoices later). Until invoices exist the source is
// `noInvoicesYet`, which always returns 0.

import type { Settings } from "../settings/schema";

/** Asia/Manila is UTC+8 all year (no daylight saving). */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface GrossSalesSource {
  /** Gross sales (₱, VAT-exclusive invoice totals, not voided) dated in [from, to). */
  grossSalesBetween(from: Date, to: Date): Promise<number>;
}

// TODO(Billing): replace with a source that sums non-voided invoices.
export const noInvoicesYet: GrossSalesSource = {
  async grossSalesBetween() {
    return 0;
  },
};

/** Start of Jan 1 of `year` in Manila, as a UTC instant. */
export function taxYearStart(year: number): Date {
  return new Date(Date.UTC(year, 0, 1) - MANILA_OFFSET_MS);
}

/** Gross sales from Jan 1 of the tax year up to `now` (or the year's end, if it's over). */
export async function getGrossSalesYtd(year: number, now: Date = new Date(), source: GrossSalesSource = noInvoicesYet): Promise<number> {
  const from = taxYearStart(year);
  const end = taxYearStart(year + 1);
  if (now <= from) return 0;
  const to = now < end ? now : end;
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

export async function getNonVatMeter(taxYear: Settings["taxYear"], now: Date = new Date(), source: GrossSalesSource = noInvoicesYet): Promise<NonVatMeter> {
  return nonVatMeter(await getGrossSalesYtd(taxYear.year, now, source), taxYear);
}

export const NON_VAT_MESSAGES: Record<NonVatLevel, string | null> = {
  ok: null,
  first: "Getting close to the non-VAT limit.",
  second: "Almost at the non-VAT limit. Talk to the accountant.",
  over: "Over the non-VAT limit. Talk to the accountant now.",
};
