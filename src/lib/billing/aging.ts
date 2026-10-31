// AR aging buckets from billing dueDate vs Manila today.
// Buckets: Current (not yet due), 1–30, 31–60, 61–90, 90+ days past due.

import { fromScaled, toScaled } from "../quotes/calc";
import { billingToday, calendarDaysBetween } from "./dates";

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGING_BUCKETS: readonly AgingBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90_plus: "90+",
};

/** Which bucket a (dueDate, today) pair falls into. Balance is ignored here. */
export function agingBucket(dueDate: Date, today: Date = billingToday()): AgingBucket {
  const days = calendarDaysBetween(dueDate, today);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export type AgingAmounts = Record<AgingBucket, string> & { total: string };

export function emptyAging(): AgingAmounts {
  return { current: "0.00", d1_30: "0.00", d31_60: "0.00", d61_90: "0.00", d90_plus: "0.00", total: "0.00" };
}

/** Sum balances into aging buckets. Only include rows with balance > 0. */
export function sumAging(
  rows: readonly { dueDate: Date; balance: string }[],
  today: Date = billingToday(),
): AgingAmounts {
  const cents: Record<AgingBucket, bigint> = {
    current: 0n,
    d1_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90_plus: 0n,
  };
  for (const r of rows) {
    const bal = toScaled(r.balance, 2);
    if (bal <= 0n) continue;
    cents[agingBucket(r.dueDate, today)] += bal;
  }
  const total = Object.values(cents).reduce((a, b) => a + b, 0n);
  return {
    current: fromScaled(cents.current, 2),
    d1_30: fromScaled(cents.d1_30, 2),
    d31_60: fromScaled(cents.d31_60, 2),
    d61_90: fromScaled(cents.d61_90, 2),
    d90_plus: fromScaled(cents.d90_plus, 2),
    total: fromScaled(total, 2),
  };
}
