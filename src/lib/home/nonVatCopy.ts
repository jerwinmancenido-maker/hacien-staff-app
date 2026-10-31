// Home Non-VAT card copy in one place — wording still waiting on the owner's
// final OK. Warn thresholds come from Settings → Tax year (warnFirstPct /
// warnSecondPct); defaults are 70 and 90. The title limit comes from
// settings.taxYear.nonVatLimit (not a hardcoded ₱3M).

/** Compact limit for titles, e.g. 3000000 → "₱3M", 1500000 → "₱1.5M". */
export function formatCompactPesoLimit(limit: number): string {
  const n = Math.abs(Number(limit));
  if (!Number.isFinite(n) || n <= 0) return "₱0";
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    const label = Number.isInteger(millions)
      ? String(millions)
      : millions.toFixed(2).replace(/\.?0+$/, "");
    return `₱${label}M`;
  }
  if (n >= 1_000) {
    const thousands = n / 1_000;
    const label = Number.isInteger(thousands)
      ? String(thousands)
      : thousands.toFixed(2).replace(/\.?0+$/, "");
    return `₱${label}K`;
  }
  return `₱${Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "")}`;
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
