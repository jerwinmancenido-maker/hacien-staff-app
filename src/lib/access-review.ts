import { manilaToday } from "./format";

/** S-58: access review cadence — every 90 days, counted in Manila calendar days. */
export const ACCESS_REVIEW_DAYS = 90;

export function accessReviewDue(lastReviewedAt: Date | null, now = manilaToday()): boolean {
  if (!lastReviewedAt) return true;
  const reviewed = new Date(lastReviewedAt.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const days = Math.floor((now.getTime() - reviewed.getTime()) / (24 * 60 * 60 * 1000));
  return days > ACCESS_REVIEW_DAYS;
}

export function accessReviewLabel(lastReviewedAt: Date | null, now = manilaToday()): string {
  if (!lastReviewedAt) return "Never reviewed";
  const reviewed = new Date(lastReviewedAt.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const days = Math.floor((now.getTime() - reviewed.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Reviewed today";
  return `Reviewed ${days} day${days === 1 ? "" : "s"} ago`;
}
