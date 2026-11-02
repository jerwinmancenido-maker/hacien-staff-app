// Pure money helpers for the Home dashboard (₱ strings, exact cents).

import { fromScaled, toScaled } from "../quotes/calc";

/** Whole pesos, half-up, away from zero. Input is centavos. */
function roundPesosHalfUp(cents: bigint): bigint {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const pesos = (abs + 50n) / 100n;
  return neg ? -pesos : pesos;
}

/**
 * Whole-peso cash, 2307, and total for the Home collected card.
 * Total is the exact sum, rounded once. Cash keeps that same half-up rule.
 * 2307 is the remainder, so the two shown parts always equal the shown total.
 */
export function collectedWholePesos(cash: string, received2307: string): {
  cash: string;
  received2307: string;
  total: string;
} {
  const cashCents = toScaled(cash || "0", 2);
  const whCents = toScaled(received2307 || "0", 2);
  const totalPesos = roundPesosHalfUp(cashCents + whCents);
  const cashPesos = roundPesosHalfUp(cashCents);
  const whPesos = totalPesos - cashPesos;
  return {
    cash: fromScaled(cashPesos * 100n, 2),
    received2307: fromScaled(whPesos * 100n, 2),
    total: fromScaled(totalPesos * 100n, 2),
  };
}

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
