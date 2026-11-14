// Phase 4 #10: period close — PURE, client-safe helpers.
//
// A period is a calendar month keyed "YYYY-MM" ("2026-11"), derived
// from a record date's UTC year/month — the same UTC convention the
// services already use for @db.Date values (e.g. recordExpense).
// This module has NO server imports (no settings, no DB) so client
// components can use the labels and validation without dragging the
// server chain into the browser bundle. The guard, the close/reopen
// service and the flag check live in services/period-close.ts.

export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function isValidYearMonth(value: string): boolean {
  return YEAR_MONTH_PATTERN.test(value);
}

/** The period key for a date, from its UTC year/month. */
export function yearMonthOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** "2026-11" -> "November 2026". Invalid keys are returned as-is. */
export function monthLabel(yearMonth: string): string {
  if (!isValidYearMonth(yearMonth)) return yearMonth;
  const [year, month] = yearMonth.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** The month before a valid "YYYY-MM" key (the Books card's default close target). */
export function previousYearMonth(yearMonth: string): string {
  if (!isValidYearMonth(yearMonth)) return yearMonth;
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The refusal every guarded posting path surfaces for a closed month. */
export function closedPeriodMessage(yearMonth: string): string {
  return `${monthLabel(yearMonth)} is closed. An Admin can reopen it under Books → Period close.`;
}

/** Sync check from env only (useful in unit tests without DB). */
export function periodCloseEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean | null {
  const raw = (env.PERIOD_CLOSE_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}
