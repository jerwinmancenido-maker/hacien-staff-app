// Allocation rules for collections → billings, including customer credit
// (unapplied cash). Pure validation; the service enforces them inside a TX.

import { fromScaled, toScaled } from "../quotes/calc";
import { billingBalance } from "./status";

export type AllocationInput = {
  billingId: string;
  cashApplied: string;
  withholdingApplied: string;
};

export type AllocationIssue = { field?: string; message: string };

export type BillingForAlloc = {
  id: string;
  amount: string;
  /** Already applied from *other* posted collections (exclude the one being edited). */
  alreadyCash: string;
  alreadyWithholding: string;
};

/**
 * Validate a set of allocations against open billings and the cash received.
 * - Per billing: existing + new cash + withholding ≤ billing.amount
 * - Sum of cashApplied ≤ amountReceived (remainder = customer credit)
 * - Each applied amount ≥ 0; at least one of cash/withholding > 0 per row
 * - No duplicate billing ids
 */
export function validateAllocations(
  amountReceived: string,
  allocations: readonly AllocationInput[],
  billings: readonly BillingForAlloc[],
): AllocationIssue | null {
  const byId = new Map(billings.map((b) => [b.id, b]));
  const seen = new Set<string>();
  let cashSum = 0n;
  for (const a of allocations) {
    if (seen.has(a.billingId)) return { field: "allocations", message: "A billing appears more than once in the allocation." };
    seen.add(a.billingId);
    const billing = byId.get(a.billingId);
    if (!billing) return { field: "allocations", message: "One of the billings isn't open for this customer." };
    let cash: bigint;
    let wh: bigint;
    try {
      cash = toScaled(a.cashApplied || "0", 2);
      wh = toScaled(a.withholdingApplied || "0", 2);
    } catch {
      return { field: "allocations", message: "Enter cash and withholding as numbers with up to 2 decimals." };
    }
    if (cash < 0n || wh < 0n) return { field: "allocations", message: "Applied amounts can't be negative." };
    if (cash === 0n && wh === 0n) return { field: "allocations", message: "Each allocation needs cash or withholding greater than 0." };
    const remaining = toScaled(
      billingBalance(billing.amount, {
        cashApplied: billing.alreadyCash,
        withholdingApplied: billing.alreadyWithholding,
      }),
      2,
    );
    if (cash + wh > remaining) {
      return {
        field: "allocations",
        message: `Allocation exceeds the remaining balance on a billing (₱${fromScaled(remaining, 2)} left).`,
      };
    }
    cashSum += cash;
  }
  const received = toScaled(amountReceived, 2);
  if (cashSum > received) {
    return {
      field: "allocations",
      message: `Cash applied (₱${fromScaled(cashSum, 2)}) can't exceed the amount received (₱${fromScaled(received, 2)}).`,
    };
  }
  return null;
}

/**
 * Auto-fill oldest-open billings first with cash only (no withholding), up to
 * amountReceived. Used as the default when recording a collection.
 */
export function autoAllocateOldestFirst(
  amountReceived: string,
  billings: readonly (BillingForAlloc & { dueDate: Date })[],
): AllocationInput[] {
  const sorted = [...billings].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id));
  let left = toScaled(amountReceived, 2);
  const out: AllocationInput[] = [];
  for (const b of sorted) {
    if (left <= 0n) break;
    const rem = toScaled(
      billingBalance(b.amount, { cashApplied: b.alreadyCash, withholdingApplied: b.alreadyWithholding }),
      2,
    );
    if (rem <= 0n) continue;
    const take = rem < left ? rem : left;
    out.push({ billingId: b.id, cashApplied: fromScaled(take, 2), withholdingApplied: "0.00" });
    left -= take;
  }
  return out;
}

/** True when applying `cash` more would exceed the collection's unapplied credit. */
export function wouldExceedCredit(unapplied: string, additionalCash: string): boolean {
  return toScaled(additionalCash, 2) > toScaled(unapplied, 2);
}
