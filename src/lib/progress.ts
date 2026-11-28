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

// ── ERP adoption item 15: derived sales-order stage label ─────────────────
// A plain-language "where is this order now?" label, computed at render
// from the order's status and the SAME item-7 measures above — never
// stored. The label names the earliest incomplete step in the order's
// life (delivery → billing → payment): billing and payment can run ahead
// of delivery (upfront terms), but goods still owed are what operations
// must see first, and the bars beside the label show the money state.
// A step counts complete at ≥100 — over-delivery / over-billing /
// over-payment are complete, with the true number still on the bars.
// A null measure has no true base, so its step is skipped: no lines or a
// ₱0 total can neither block nor fabricate a stage.

/** The three item-7 measures a stage is derived from (structural twin of
 *  SalesOrderProgress in lib/quotes/views — kept separate so this module
 *  stays free of the views import). */
export type StageMeasures = {
  deliveredPct: number | null;
  billedPct: number | null;
  paidPct: number | null;
};

export type SalesOrderStage =
  | "Not yet delivered"
  | "Part-delivered"
  | "Delivered, not yet billed"
  | "Not yet billed"
  | "Part-billed"
  | "Billed, awaiting payment"
  | "Part-paid"
  | "Paid in full"
  | "Fully delivered"
  | "Nothing outstanding"
  | "Closed";

/**
 * The one stage for an order, or null when no stage should render (VOID —
 * the list keeps showing the VOID status alone, as before item 15).
 * First match wins, in lifecycle order:
 *   VOID → null · CLOSED → "Closed" (the deliberate status wins; the bars
 *   still show any measures left incomplete) ·
 *   delivered = 0 → "Not yet delivered" · 0 < delivered < 100 →
 *   "Part-delivered" · billed = 0 → "Delivered, not yet billed" (or
 *   "Not yet billed" when there are no live lines to have delivered) ·
 *   billed < 100 → "Part-billed" · paid = 0 → "Billed, awaiting payment" ·
 *   paid < 100 → "Part-paid" · paid ≥ 100 → "Paid in full" · nothing was
 *   ever billed (a ₱0 order) → "Fully delivered", or "Nothing
 *   outstanding" when there are no live lines either.
 */
export function salesOrderStage(status: string, m: StageMeasures): SalesOrderStage | null {
  if (status === "VOID") return null;
  if (status === "CLOSED") return "Closed";
  const d = m.deliveredPct;
  const b = m.billedPct;
  const p = m.paidPct;
  if (d !== null && d <= 0) return "Not yet delivered";
  if (d !== null && d < 100) return "Part-delivered";
  if (b !== null && b <= 0) return d !== null ? "Delivered, not yet billed" : "Not yet billed";
  if (b !== null && b < 100) return "Part-billed";
  if (p !== null && p <= 0) return "Billed, awaiting payment";
  if (p !== null && p < 100) return "Part-paid";
  if (p !== null) return "Paid in full";
  return d !== null ? "Fully delivered" : "Nothing outstanding";
}
