// Free-text line WH% (staff editor) → stored fraction. Shared by the browser
// editor and server validation so both accept the same sane range.

/** Inclusive percent bounds for a line WH% field (0% … 15%). */
export const WITHHOLDING_PERCENT_MIN = 0;
export const WITHHOLDING_PERCENT_MAX = 15;

/** Plain staff-facing error for out-of-range or non-numeric WH%. */
export const WITHHOLDING_PERCENT_RANGE_ERROR = "Withholding percent must be between 0 and 15.";

/** Stored rate fraction upper bound (15% → 0.1500). */
export const WITHHOLDING_RATE_MAX = "0.1500";

export type ParseWithholdingPercentOk = { ok: true; rate: string | null };
export type ParseWithholdingPercentErr = { ok: false; message: string };
export type ParseWithholdingPercentResult = ParseWithholdingPercentOk | ParseWithholdingPercentErr;

/**
 * Parse the free-text WH% box (e.g. "1.5", "0", "15"). Empty → null rate.
 * Rejects non-numeric, negative, and values above 15.
 */
export function parseWithholdingPercentInput(raw: string): ParseWithholdingPercentResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, rate: null };
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, message: WITHHOLDING_PERCENT_RANGE_ERROR };
  }
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < WITHHOLDING_PERCENT_MIN || pct > WITHHOLDING_PERCENT_MAX) {
    return { ok: false, message: WITHHOLDING_PERCENT_RANGE_ERROR };
  }
  return { ok: true, rate: (pct / 100).toFixed(4) };
}

/** True when a stored fraction string is inside [0, 0.15]. */
export function isWithholdingRateInRange(rate: string): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(rate.trim())) return false;
  const n = Number(rate);
  return Number.isFinite(n) && n >= 0 && n <= 0.15;
}
