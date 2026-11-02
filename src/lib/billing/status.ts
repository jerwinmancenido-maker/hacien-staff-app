// Billing status derivation and SO remaining-to-bill math. Pure helpers.

import type { BillingStatus } from "@prisma/client";
import { fromScaled, toScaled } from "../quotes/calc";

export type AppliedTotals = { cashApplied: string; withholdingApplied: string };

/** Balance remaining on a billing = amount − cash − withholding applied. */
export function billingBalance(amount: string, applied: AppliedTotals): string {
  return fromScaled(toScaled(amount, 2) - toScaled(applied.cashApplied, 2) - toScaled(applied.withholdingApplied, 2), 2);
}

/** OPEN / PARTIALLY_PAID / PAID from applied amounts (VOID is set explicitly). */
export function deriveBillingStatus(amount: string, applied: AppliedTotals): Exclude<BillingStatus, "VOID"> {
  const amt = toScaled(amount, 2);
  const paid = toScaled(applied.cashApplied, 2) + toScaled(applied.withholdingApplied, 2);
  if (paid <= 0n) return "OPEN";
  if (paid >= amt) return "PAID";
  return "PARTIALLY_PAID";
}

/** Sum of non-void billing amounts on an SO; remaining = contractPrice − billed. */
export function remainingToBill(contractPrice: string, nonVoidBillingAmounts: readonly string[]): string {
  const billed = nonVoidBillingAmounts.reduce((acc, a) => acc + toScaled(a, 2), 0n);
  return fromScaled(toScaled(contractPrice, 2) - billed, 2);
}

export type SoBillingMoney = {
  status: string;
  amount: string;
  cashApplied: string;
  withholdingApplied: string;
};

export type SoMoneySnapshot = {
  billed: string;
  leftToBill: string;
  unpaidBilled: string;
  cashCollected: string;
  received2307: string;
  totalPaid: string;
  /** Display only. The sales order row stays OPEN until it is voided. */
  completed: boolean;
};

/**
 * Sales-order money from billing rows. VOID rows are ignored.
 * Completed when the order is OPEN, left to bill is ₱0.00, and unpaid billed is ₱0.00
 * (cash + 2307 credited equals the non-void billed total).
 */
export function salesOrderMoney(
  soStatus: "OPEN" | "VOID",
  contractPrice: string,
  billings: readonly SoBillingMoney[],
): SoMoneySnapshot {
  const live = billings.filter((b) => b.status !== "VOID");
  let billed = 0n;
  let cash = 0n;
  let wh = 0n;
  for (const b of live) {
    billed += toScaled(b.amount || "0", 2);
    cash += toScaled(b.cashApplied || "0", 2);
    wh += toScaled(b.withholdingApplied || "0", 2);
  }
  const left = toScaled(contractPrice, 2) - billed;
  const unpaid = billed - cash - wh;
  return {
    billed: fromScaled(billed, 2),
    leftToBill: fromScaled(left, 2),
    unpaidBilled: fromScaled(unpaid, 2),
    cashCollected: fromScaled(cash, 2),
    received2307: fromScaled(wh, 2),
    totalPaid: fromScaled(cash + wh, 2),
    completed: soStatus === "OPEN" && left === 0n && unpaid === 0n,
  };
}

/** Pro-rata withholding expected for a billing amount against the SO totals. */
export function proRataWithholding(billingAmount: string, contractPrice: string, withholdingTotal: string): string {
  const contract = toScaled(contractPrice, 2);
  if (contract === 0n) return "0.00";
  const amount = toScaled(billingAmount, 2);
  const wh = toScaled(withholdingTotal, 2);
  // Round half away from zero to 2 dp: (amount / contract) × withholding.
  const num = amount * wh;
  const neg = num < 0n !== contract < 0n;
  const a = num < 0n ? -num : num;
  const b = contract < 0n ? -contract : contract;
  const q = (a * 2n + b) / (b * 2n);
  return fromScaled(neg ? -q : q, 2);
}

export function netExpected(amount: string, withholdingExpected: string): string {
  return fromScaled(toScaled(amount, 2) - toScaled(withholdingExpected, 2), 2);
}

/** Unapplied cash on a collection = amountReceived − sum(cashApplied). */
export function unappliedCash(amountReceived: string, cashAppliedSums: readonly string[]): string {
  const applied = cashAppliedSums.reduce((acc, a) => acc + toScaled(a, 2), 0n);
  return fromScaled(toScaled(amountReceived, 2) - applied, 2);
}

export type DatedCashApplication = { cashApplied: string; date: Date };

/**
 * Unapplied cash as of a cutoff date: only applications dated strictly before
 * `asOf` reduce the credit. A collection before `asOf` that is applied on or
 * after `asOf` still counts as unapplied opening credit.
 */
export function unappliedCashAsOf(
  amountReceived: string,
  applications: readonly DatedCashApplication[],
  asOf: Date,
): string {
  return unappliedCash(
    amountReceived,
    applications.filter((a) => a.date < asOf).map((a) => a.cashApplied),
  );
}

/**
 * Total customer credit from prior-period collections as of `from`
 * (collections dated before `from`, minus applications dated before `from`).
 */
export function openingCreditAsOf(
  priorCollections: readonly {
    amountReceived: string;
    applications: readonly DatedCashApplication[];
  }[],
  from: Date,
): string {
  let credit = 0n;
  for (const c of priorCollections) {
    credit += toScaled(unappliedCashAsOf(c.amountReceived, c.applications, from), 2);
  }
  return fromScaled(credit, 2);
}
