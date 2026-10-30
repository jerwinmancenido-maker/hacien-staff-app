// Expiry badges for business documents. Dates are DATE values (00:00 UTC of the
// calendar day); `today` is Manila's today (manilaToday()).

export type ExpiryStatus =
  | { state: "none" }
  | { state: "valid"; days: number }
  | { state: "expiring"; days: number }
  | { state: "expired"; days: number };

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_EXPIRY_WARNING_DAYS = 30;

export function expiryStatus(expiry: Date | null | undefined, today: Date, warnDays: number = DEFAULT_EXPIRY_WARNING_DAYS): ExpiryStatus {
  if (!expiry) return { state: "none" };
  const days = Math.round((expiry.getTime() - today.getTime()) / DAY);
  if (days < 0) return { state: "expired", days };
  if (days <= warnDays) return { state: "expiring", days };
  return { state: "valid", days };
}

export function expiryLabel(s: ExpiryStatus): string {
  switch (s.state) {
    case "none":
      return "No expiry";
    case "expired":
      return "Expired";
    case "expiring":
      return s.days === 0 ? "Expires today" : `Expires in ${s.days} day${s.days === 1 ? "" : "s"}`;
    case "valid":
      return "Valid";
  }
}

/** Last expiry date that counts as "expiring" (or expired) on `today`. */
export function expiringCutoff(today: Date, warnDays: number): Date {
  return new Date(today.getTime() + warnDays * DAY);
}
