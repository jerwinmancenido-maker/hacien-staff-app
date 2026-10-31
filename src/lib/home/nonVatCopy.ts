// Home Non-VAT card copy in one place — wording still waiting on the owner's
// final OK. Warn thresholds come from Settings → Tax year (warnFirstPct /
// warnSecondPct); defaults are 70 and 90.

/** Card title — keep in sync with the sidebar tracker label. */
export const HOME_NON_VAT_TITLE = "Non-VAT sales limit (₱3M)";

/** Helper under the meter. `warnFirstPct` / `warnSecondPct` from settings. */
export function homeNonVatHelperLine(warnFirstPct: number, warnSecondPct: number): string {
  return `Estimate based on invoices in this app for this year. Your accountant's books are the official count. Warns at ${warnFirstPct}% and ${warnSecondPct}%.`;
}
