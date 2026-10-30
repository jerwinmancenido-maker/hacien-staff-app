// Supplier bill payment status derivation. Pure helpers.
// RECORDED = unpaid (legacy enum value kept for additive migration).

import type { SupplierBillStatus } from "@prisma/client";
import { fromScaled, toScaled } from "../quotes/calc";

export type AppliedTotals = { cashApplied: string; withholdingApplied: string };

/** Balance remaining on a supplier bill = amount − cash − EWT applied. */
export function supplierBillBalance(amount: string, applied: AppliedTotals): string {
  return fromScaled(toScaled(amount, 2) - toScaled(applied.cashApplied, 2) - toScaled(applied.withholdingApplied, 2), 2);
}

/** RECORDED (unpaid) / PARTIALLY_PAID / PAID from applied amounts (VOID is set explicitly). */
export function deriveSupplierBillStatus(amount: string, applied: AppliedTotals): Exclude<SupplierBillStatus, "VOID"> {
  const amt = toScaled(amount, 2);
  const paid = toScaled(applied.cashApplied, 2) + toScaled(applied.withholdingApplied, 2);
  if (paid <= 0n) return "RECORDED";
  if (paid >= amt) return "PAID";
  return "PARTIALLY_PAID";
}

/** Withholding amount from gross × rate (half-up to 2 dp). */
export function withholdingFromRate(gross: string, rate: string): string {
  const g = toScaled(gross, 2);
  const r = toScaled(rate, 4);
  // amount = gross × rate; rate has 4 dp so scale product by 10^4 then round to 2 dp.
  const product = g * r; // scale 2+4 = 6
  // Round half-up to 2 dp: look at digit at scale 3 (product / 10^4, then /100 with half-up).
  const toCents = (product + 5000n) / 10000n;
  return fromScaled(toCents, 2);
}
