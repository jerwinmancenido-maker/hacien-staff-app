// SL-05: supplier warranty "ending soon" window (Manila date-only).

import { addDays, manilaToday } from "../format";

/** Default window: today through today + 30 Manila days. Not a Settings field. */
export const WARRANTY_SOON_DAYS = 30;

/**
 * True when a stored warranty end date falls in [today, today + 30]
 * using the same Manila date-only values as the bell's 7-day billing window.
 */
export function isWarrantyEndingSoon(
  warrantyEndDate: Date | null | undefined,
  today: Date = manilaToday(),
): boolean {
  if (!warrantyEndDate) return false;
  const end = warrantyEndDate.getTime();
  if (Number.isNaN(end)) return false;
  return end >= today.getTime() && end <= addDays(today, WARRANTY_SOON_DAYS).getTime();
}

/** Inclusive Prisma range for POSTED receiving lines ending soon. */
export function warrantySoonWindow(today: Date = manilaToday()) {
  return { from: today, to: addDays(today, WARRANTY_SOON_DAYS) };
}
