// Markers pair 3 (Billing vs SO) + pair 4's receiving half — pure coverage
// notes, approved by Jerwin with the other marker pairs on 2026-11-10.
// Neutral wording by design: a partial billing and a short delivery are
// normal states, not errors — these notes state position, never blame.
// All comparisons at money scale (2dp) via toScaled.

import { fromScaled, toScaled } from "../quotes/calc";

/** "Billed ₱X of ₱Y on this order · ₱Z left to bill" (or "fully billed"). */
export function billingCoverageNote(input: { billedTotal: string; contractPrice: string }): string {
  const billed = toScaled(input.billedTotal, 2);
  const total = toScaled(input.contractPrice, 2);
  const left = total - billed;
  if (left <= 0n) {
    return `Fully billed — ₱${fromScaled(billed, 2)} of ₱${fromScaled(total, 2)} on this order.`;
  }
  return `Part of this order — billed ₱${fromScaled(billed, 2)} of ₱${fromScaled(total, 2)} · ₱${fromScaled(left, 2)} left to bill.`;
}

/** Per-billing position: "Billing 2 of 3 on this order". Null when it is the
 * only billing (nothing to compare). Position counts live (non-void)
 * billings in creation order. */
export function billingPositionNote(index: number, count: number): string | null {
  if (count <= 1) return null;
  return `Billing ${index + 1} of ${count} on this order.`;
}

/** "Received 8 of 10 · 2 still to come" / "Fully received" / "Received 12 of
 * 10 — 2 more than ordered". Null when nothing has been received yet. */
export function receivingCoverageNote(input: { orderedQty: string; receivedQty: string; unit: string }): string | null {
  const ordered = toScaled(input.orderedQty, 2);
  const received = toScaled(input.receivedQty, 2);
  if (received <= 0n) return null;
  if (received === ordered) return `Fully received — ${input.receivedQty} of ${input.orderedQty} ${input.unit}.`;
  if (received < ordered) {
    return `Received ${input.receivedQty} of ${input.orderedQty} ${input.unit} · ${fromScaled(ordered - received, 2)} still to come.`;
  }
  return `Received ${input.receivedQty} of ${input.orderedQty} ${input.unit} — ${fromScaled(received - ordered, 2)} more than ordered.`;
}
