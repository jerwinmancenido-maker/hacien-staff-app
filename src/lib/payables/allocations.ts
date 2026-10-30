// Allocation rules for supplier payments → supplier bills.
// Exact equality: sum(cash) must equal amountPaid AND there is no unapplied cash.
// Per bill: existing + new cash + EWT ≤ bill.amount.
// Pure validation; the service enforces them inside a TX.

import { fromScaled, toScaled } from "../quotes/calc";
import { supplierBillBalance } from "./status";

export type PaymentAllocationInput = {
  supplierBillId: string;
  cashApplied: string;
  withholdingApplied: string;
  withholdingRate: string;
  atcCode: string | null;
};

export type AllocationIssue = { field?: string; message: string };

export type BillForAlloc = {
  id: string;
  amount: string;
  /** Already applied from *other* posted payments. */
  alreadyCash: string;
  alreadyWithholding: string;
};

/**
 * Validate allocations against open bills and the cash paid.
 * - Per bill: existing + new cash + withholding ≤ bill.amount
 * - Sum of cashApplied must equal amountPaid exactly (no over- or under-allocation)
 * - Each applied amount ≥ 0; at least one of cash/withholding > 0 per row
 * - At least one allocation
 * - No duplicate bill ids
 */
export function validatePaymentAllocations(
  amountPaid: string,
  allocations: readonly PaymentAllocationInput[],
  bills: readonly BillForAlloc[],
): AllocationIssue | null {
  if (!allocations.length) {
    return {
      field: "allocations",
      message: "Put the cash on at least one unpaid bill in the table below.",
    };
  }
  const byId = new Map(bills.map((b) => [b.id, b]));
  const seen = new Set<string>();
  let cashSum = 0n;
  let whSum = 0n;
  for (const a of allocations) {
    if (seen.has(a.supplierBillId)) {
      return { field: "allocations", message: "The same bill appears twice. Keep one row per bill." };
    }
    seen.add(a.supplierBillId);
    const bill = byId.get(a.supplierBillId);
    if (!bill) {
      return {
        field: "allocations",
        message: "One of those bills is already paid or void. Refresh the page and try again.",
      };
    }
    let cash: bigint;
    let wh: bigint;
    let rate: bigint;
    try {
      cash = toScaled(a.cashApplied || "0", 2);
      wh = toScaled(a.withholdingApplied || "0", 2);
      rate = toScaled(a.withholdingRate || "0", 4);
    } catch {
      return {
        field: "allocations",
        message: "Use numbers only for cash, withholding and rate (e.g. 1000.00 or 1 for 1%).",
      };
    }
    if (cash < 0n || wh < 0n) {
      return { field: "allocations", message: "Amounts can't be negative. Clear a cell or enter 0." };
    }
    if (rate < 0n) return { field: "allocations", message: "Withholding rate can't be negative." };
    if (cash === 0n && wh === 0n) {
      return {
        field: "allocations",
        message: "Each bill you include needs some cash or withholding. Clear unused rows by setting cash to blank.",
      };
    }
    const remaining = toScaled(
      supplierBillBalance(bill.amount, {
        cashApplied: bill.alreadyCash,
        withholdingApplied: bill.alreadyWithholding,
      }),
      2,
    );
    if (cash + wh > remaining) {
      return {
        field: "allocations",
        message: `That bill only has ₱${fromScaled(remaining, 2)} left. Lower the cash or withholding on that row.`,
      };
    }
    cashSum += cash;
    whSum += wh;
  }
  const paid = toScaled(amountPaid, 2);
  if (cashSum > paid) {
    const over = fromScaled(cashSum - paid, 2);
    return {
      field: "allocations",
      message: `You've put ₱${over} too much on bills. Lower a cash amount so “Left to allocate” is ₱0.00.`,
    };
  }
  if (cashSum < paid) {
    const left = fromScaled(paid - cashSum, 2);
    return {
      field: "allocations",
      message: `₱${left} is still left to allocate. Put it on a bill (or lower Cash paid) so nothing is left over.`,
    };
  }
  void whSum;
  return null;
}

/**
 * Auto-fill oldest-open bills first with cash only (no withholding), up to
 * amountPaid. Used as the default when recording a payment.
 */
export function autoAllocateBillsOldestFirst(
  amountPaid: string,
  bills: readonly (BillForAlloc & { dueDate: Date })[],
): PaymentAllocationInput[] {
  const sorted = [...bills].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id));
  let left = toScaled(amountPaid, 2);
  const out: PaymentAllocationInput[] = [];
  for (const b of sorted) {
    if (left <= 0n) break;
    const rem = toScaled(
      supplierBillBalance(b.amount, { cashApplied: b.alreadyCash, withholdingApplied: b.alreadyWithholding }),
      2,
    );
    if (rem <= 0n) continue;
    const take = rem < left ? rem : left;
    out.push({
      supplierBillId: b.id,
      cashApplied: fromScaled(take, 2),
      withholdingApplied: "0.00",
      withholdingRate: "0.0000",
      atcCode: null,
    });
    left -= take;
  }
  return out;
}
