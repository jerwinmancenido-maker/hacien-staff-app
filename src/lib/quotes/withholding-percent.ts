// Free-text line WH% (staff editor) → stored fraction. Shared by the browser
// editor and server validation so both accept the same sane range.

/** Inclusive percent bounds for a line WH% field (0% … 15%). */
export const WITHHOLDING_PERCENT_MIN = 0;
export const WITHHOLDING_PERCENT_MAX = 15;

/** Plain staff-facing error for out-of-range WH%. */
export const WITHHOLDING_PERCENT_RANGE_ERROR = "Withholding percent must be between 0 and 15.";

/** Plain staff-facing error for non-numeric WH% input. */
export const WITHHOLDING_PERCENT_NON_NUMERIC_ERROR = "Withholding percent must be a number.";

/** Stored rate fraction upper bound (15% → 0.1500). */
export const WITHHOLDING_RATE_MAX = "0.1500";

export type ParseWithholdingPercentOk = { ok: true; rate: string | null };
export type ParseWithholdingPercentErr = { ok: false; message: string };
export type ParseWithholdingPercentResult = ParseWithholdingPercentOk | ParseWithholdingPercentErr;

/**
 * Parse the free-text WH% box (e.g. "1.5", "0", "15").
 * Empty → explicit "0.0000" so a cleared field is distinct from a legacy NULL.
 * Rejects non-numeric, negative, and values above 15.
 */
export function parseWithholdingPercentInput(raw: string): ParseWithholdingPercentResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, rate: "0.0000" };
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, message: WITHHOLDING_PERCENT_NON_NUMERIC_ERROR };
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
