// Phase 2 #6 — ONE customer-exposure helper (master plan M9).
//
// Every credit-limit warning in the app must quote the SAME figure, so the
// exposure computation lives exactly here:
//
//   exposure = AR outstanding + unbilled value of open sales orders
//   AR outstanding = Σ non-VOID billing amounts
//                    − Σ cash + withholding applied by POSTED collections
//                    − Σ return-credit applied from POSTED customer returns
//   unbilled = Σ over OPEN sales orders of (contractPrice − non-VOID billings)
//
// Voided billings and voided sales orders contribute ₱0 (scenario C5).
// A null or ₱0 credit limit never warns (C3), and the warning NEVER blocks
// a save (C4) — callers only display it. The check-time race is accepted by
// design: the figure can be stale the moment it is shown, and because it
// cannot block anything, a stale figure harms nothing.
//
// All queries are aggregates over one customer's documents only, using the
// customerId indexes on Billing / SalesOrder (H9 perf line) — the helper is
// safe to call inside the SO save's row lock via a transaction client.

import type { Db, Tx } from "../db";
import { money } from "../documents/common";
import { formatPeso } from "../format";
import { fromScaled, toScaled } from "../quotes/calc";

export type ExposureClient = Db | Tx;

export type CustomerExposure = {
  /** The customer's credit limit as a decimal string; null = no limit set. */
  creditLimit: string | null;
  arOutstanding: string;
  unbilledOpenOrders: string;
  totalExposure: string;
  /** True only when a positive limit exists and exposure passes it. */
  overLimit: boolean;
};

export type ExposureParts = {
  creditLimit: string | null;
  /** Σ amounts of the customer's non-VOID billings. */
  billedAmount: string;
  /** Σ cash applied to those billings by POSTED collections. */
  cashApplied: string;
  /** Σ withholding applied to those billings by POSTED collections. */
  withholdingApplied: string;
  /** Σ return-credit applied to those billings from POSTED returns. */
  creditApplied: string;
  /** Σ contractPrice of the customer's OPEN sales orders. */
  openContract: string;
  /** Σ non-VOID billing amounts on those OPEN sales orders. */
  openBilled: string;
};

const scaled = (v: string | null | undefined) => toScaled(v ?? "0", 2);
const peso = (v: bigint) => fromScaled(v < 0n ? 0n : v, 2);

/** Pure combination of the aggregate parts — unit-tested without a DB. */
export function exposureFromParts(parts: ExposureParts): CustomerExposure {
  const ar = scaled(parts.billedAmount) - scaled(parts.cashApplied) - scaled(parts.withholdingApplied) - scaled(parts.creditApplied);
  const unbilled = scaled(parts.openContract) - scaled(parts.openBilled);
  const arOutstanding = peso(ar);
  const unbilledOpenOrders = peso(unbilled);
  const total = toScaled(arOutstanding, 2) + toScaled(unbilledOpenOrders, 2);
  const totalExposure = fromScaled(total, 2);
  const limit = parts.creditLimit == null ? null : fromScaled(toScaled(parts.creditLimit, 2), 2);
  const overLimit = limit != null && toScaled(limit, 2) > 0n && total > toScaled(limit, 2);
  return { creditLimit: limit, arOutstanding, unbilledOpenOrders, totalExposure, overLimit };
}

export async function customerExposure(client: ExposureClient, customerId: string): Promise<CustomerExposure> {
  const liveBilling = { customerId, status: { not: "VOID" as const } };
  const [customer, billed, allocations, creditApps, openSos, openBilled] = await Promise.all([
    client.customer.findUnique({ where: { id: customerId }, select: { creditLimit: true } }),
    client.billing.aggregate({ where: liveBilling, _sum: { amount: true } }),
    client.collectionAllocation.aggregate({
      where: { collection: { status: "POSTED" }, billing: liveBilling },
      _sum: { cashApplied: true, withholdingApplied: true },
    }),
    client.customerCreditApplication.aggregate({
      where: {
        billing: liveBilling,
        customerCredit: { customerReturn: { status: "POSTED" } },
      },
      _sum: { cashApplied: true },
    }),
    client.salesOrder.aggregate({
      where: { customerId, status: "OPEN", voidedAt: null },
      _sum: { contractPrice: true },
    }),
    client.billing.aggregate({
      where: { ...liveBilling, salesOrder: { status: "OPEN", voidedAt: null } },
      _sum: { amount: true },
    }),
  ]);
  const sum = (v: { toFixed(n: number): string } | null | undefined) => (v == null ? "0" : money(v));
  return exposureFromParts({
    creditLimit: customer?.creditLimit == null ? null : money(customer.creditLimit),
    billedAmount: sum(billed._sum.amount),
    cashApplied: sum(allocations._sum.cashApplied),
    withholdingApplied: sum(allocations._sum.withholdingApplied),
    creditApplied: sum(creditApps._sum.cashApplied),
    openContract: sum(openSos._sum.contractPrice),
    openBilled: sum(openBilled._sum.amount),
  });
}

/**
 * The one warning sentence every surface shows, so the figure and wording
 * cannot drift between the SO page and the billing form (scenario C1).
 * Returns null when there is nothing to warn about.
 */
export function creditLimitWarningText(exposure: CustomerExposure): string | null {
  if (!exposure.overLimit || exposure.creditLimit == null) return null;
  return (
    `Over credit limit — customer exposure ${formatPeso(exposure.totalExposure)} ` +
    `(balance due ${formatPeso(exposure.arOutstanding)} + unbilled orders ${formatPeso(exposure.unbilledOpenOrders)}) ` +
    `vs limit ${formatPeso(exposure.creditLimit)}. This is a warning only; you can still save.`
  );
}
