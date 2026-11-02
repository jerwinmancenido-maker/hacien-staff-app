import { TIME_ZONE } from "../format";

export const MIN_QUOTE_VALIDITY_DAYS = 1;
export const DEFAULT_QUOTE_VALIDITY_DAYS = 15;

/**
 * Parse a date input (string YYYY-MM-DD or Date object) into [year, month, day]
 * representing a calendar day in Asia/Manila (PHT, UTC+8).
 */
export function parseManilaYmd(date: string | Date | null | undefined): [number, number, number] | null {
  if (!date) return null;
  if (typeof date === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return [y, m, d];
  }
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const parts = ymd.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (y == null || m == null || d == null) return null;
    return [y, m, d];
  }
  return null;
}

/**
 * Calculate validUntil date string (YYYY-MM-DD) from a base quote date and days.
 * Month and year rollover are computed in Asia/Manila calendar days.
 */
export function validUntilFromDays(quoteDate: string | Date | null | undefined, days: number): string | null {
  const parsed = parseManilaYmd(quoteDate);
  if (!parsed || !Number.isFinite(days)) return null;
  const [y, m, d] = parsed;
  // PHT is fixed UTC+8 with no DST; UTC calendar-day stepping is exact 86,400s per day.
  const utc = Date.UTC(y, m - 1, d);
  const targetUtc = utc + Math.round(days) * 86_400_000;
  const targetDate = new Date(targetUtc);
  return targetDate.toISOString().slice(0, 10);
}

/**
 * Calculate whole calendar days from quoteDate to validUntil.
 * Returns negative if validUntil is before quoteDate.
 * Returns null if either date is missing or invalid.
 */
export function validityDaysFromDates(
  quoteDate: string | Date | null | undefined,
  validUntil: string | Date | null | undefined,
): number | null {
  const p1 = parseManilaYmd(quoteDate);
  const p2 = parseManilaYmd(validUntil);
  if (!p1 || !p2) return null;
  const utc1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
  const utc2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
  return Math.round((utc2 - utc1) / 86_400_000);
}

/**
 * Resolves default validity days from Settings (Settings → Quotes are valid for),
 * enforcing a minimum of 1 day and falling back to 15.
 */
export function defaultQuoteValidityDays(
  settings?: { quotes?: { defaultValidityDays?: number } } | null,
): number {
  const val = settings?.quotes?.defaultValidityDays;
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.max(MIN_QUOTE_VALIDITY_DAYS, Math.floor(val));
  }
  return DEFAULT_QUOTE_VALIDITY_DAYS;
}

/**
 * Validate quote validity dates.
 * - Days must be at least 1 (minimum 1 day).
 * - validUntil date cannot be before quote date.
 */
export function validateQuoteValidity(
  quoteDate: string | Date | null | undefined,
  validUntil: string | Date | null | undefined,
): { valid: boolean; error?: string } {
  const days = validityDaysFromDates(quoteDate, validUntil);
  if (days === null) {
    return { valid: false, error: "Pick a valid date." };
  }
  if (days < 0) {
    return { valid: false, error: "Valid until can't be before the quote date." };
  }
  if (days < MIN_QUOTE_VALIDITY_DAYS) {
    return { valid: false, error: "At least 1 day." };
  }
  return { valid: true };
}
