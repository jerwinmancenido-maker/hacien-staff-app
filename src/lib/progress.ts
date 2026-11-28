// Per-document progress percentages for order lists (ERP adoption item 7).
// Pure helpers — the list views feed them the same aggregates the document
// pages use, and the list component renders the result.
//
// Truth rule: a percentage exists only when its denominator is a real,
// positive base. A measure that cannot be computed truthfully (nothing
// billed yet, a ₱0 order) yields null and the list shows NO bar for it —
// never a fake 0. A computed 0 (base exists, nothing done yet) is a true 0
// and does show.

import { toScaled } from "./quotes/calc";

/**
 * numerator / denominator as a percentage with 2 decimals (e.g. 83.33),
 * computed in integer math from the 2dp money/qty strings. Returns null
 * when the denominator is zero or negative. The result is NOT clamped:
 * over-billing / over-delivery stays visible as a value above 100 (the
 * bar fill clamps at 100 in the component; the printed number stays true).
 * A negative numerator reads as 0 — the sums behind these measures cannot
 * be negative, so this is only a guard.
 */
export function percentOf(numerator: string, denominator: string): number | null {
  const den = toScaled(denominator || "0", 2);
  if (den <= 0n) return null;
  const num = toScaled(numerator || "0", 2);
  if (num <= 0n) return 0;
  // Hundredths of a percent, rounded half up: round(num × 10000 / den).
  const hundredths = (num * 20000n + den) / (den * 2n);
  return Number(hundredths) / 100;
}

/** Whole-percent label for a percentOf value (104 stays "104%"). */
export function percentLabel(pct: number): string {
  return `${Math.round(pct)}%`;
}

/** Bar fill width: the true percent clamped to the 0–100 track. */
export function percentFill(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}
