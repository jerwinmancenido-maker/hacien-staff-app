// Pure money helpers for the Home dashboard (₱ strings, exact cents).

import { fromScaled, toScaled } from "../quotes/calc";

/** Sum money strings with exact cent math. */
export function sumPesoAmounts(amounts: readonly string[]): string {
  let cents = 0n;
  for (const a of amounts) cents += toScaled(a, 2);
  return fromScaled(cents, 2);
}

export type OwedSplit = {
  /** Open receivable total. */
  total: string;
  /** Portion that is past due (grace applied upstream). */
  overdue: string;
  /** total − overdue (not past due). */
  current: string;
};

/** Split owed-by-customers into overdue (red) vs the rest. */
export function owedByCustomersSplit(totalReceivable: string, overdue: string): OwedSplit {
  const total = toScaled(totalReceivable, 2);
  const od = toScaled(overdue, 2);
  const capped = od > total ? total : od < 0n ? 0n : od;
  return {
    total: fromScaled(total, 2),
    overdue: fromScaled(capped, 2),
    current: fromScaled(total - capped, 2),
  };
}

/** True when the overdue slice should render in red. */
export function hasOverdueOwed(split: OwedSplit): boolean {
  return toScaled(split.overdue, 2) > 0n;
}
