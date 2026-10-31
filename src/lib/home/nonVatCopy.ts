// Home Non-VAT card copy in one place — wording still waiting on the owner's
// final OK. Warn thresholds come from Settings → Tax year (warnFirstPct /
// warnSecondPct); defaults are 70 and 90. The title limit comes from
// settings.taxYear.nonVatLimit (not a hardcoded ₱3M).

/** Round to 1 decimal for compact unit boundaries (avoids ₱1000K). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Compact limit for titles, e.g. 3000000 → "₱3M", 1500000 → "₱1.5M".
 * Never emits 1000K / 1000M: promote to the next unit (₱1.0M / ₱1.0B).
 * Always includes the ₱ sign.
 */
export function formatCompactPesoLimit(limit: number): string {
  const n = Math.abs(Number(limit));
  if (!Number.isFinite(n) || n <= 0) return "₱0";
  if (n < 1_000) {
    return `₱${Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "")}`;
  }

  // K → M when 1-decimal K would be 1000; M → B when 1-decimal M would be 1000.
  if (n >= 1_000_000_000 || round1(n / 1_000_000) >= 1000) {
    const billions = n / 1_000_000_000;
    if (Number.isInteger(billions)) return `₱${billions}B`;
    return `₱${round1(billions).toFixed(1)}B`;
  }
  if (n >= 1_000_000 || round1(n / 1_000) >= 1000) {
    const millions = n / 1_000_000;
    if (Number.isInteger(millions)) return `₱${millions}M`;
    // Promoted from near-1000K (e.g. 999,999 → ₱1.0M).
    if (millions < 1) return `₱${round1(millions).toFixed(1)}M`;
    return `₱${millions.toFixed(2).replace(/\.?0+$/, "")}M`;
  }

  const thousands = n / 1_000;
  if (Number.isInteger(thousands)) return `₱${thousands}K`;
  return `₱${round1(thousands).toFixed(1).replace(/\.0$/, "")}K`;
}

/** Card / sidebar title — same string in both places. */
export function homeNonVatTitle(limit: number): string {
  return `Non-VAT sales limit (${formatCompactPesoLimit(limit)})`;
}

/** @deprecated Use homeNonVatTitle(limit) — kept for a soft migration of imports. */
export const HOME_NON_VAT_TITLE = homeNonVatTitle(3_000_000);

/** Helper under the meter. `warnFirstPct` / `warnSecondPct` from settings. */
export function homeNonVatHelperLine(warnFirstPct: number, warnSecondPct: number): string {
  return `Estimate based on invoices in this app for this year. Your accountant's books are the official count. Warns at ${warnFirstPct}% and ${warnSecondPct}%.`;
}
