// Address rules as pure functions (no DB), so they are easy to test.

import type { AddressKindValue } from "../validation/addresses";

export type OwnerIds = { customerId?: string | null; supplierId?: string | null };

/** An address belongs to exactly one customer OR one supplier. */
export function ownerError(o: OwnerIds): string | null {
  const n = (o.customerId ? 1 : 0) + (o.supplierId ? 1 : 0);
  if (n === 1) return null;
  return n === 0 ? "An address needs a customer or a supplier." : "An address belongs to a customer or a supplier, not both.";
}

type Row = { id: string; kind: AddressKindValue; isDefault: boolean; createdAt: Date };

/**
 * One default per kind among the owner's active addresses: `preferId` wins its
 * kind; otherwise an existing default is kept (the newest if several), and a
 * kind with none gets its newest address. Returns the flags to change.
 */
export function defaultsPlan(active: readonly Row[], preferId?: string | null): { set: string[]; unset: string[] } {
  const set: string[] = [];
  const unset: string[] = [];
  const kinds = new Set(active.map((a) => a.kind));
  for (const kind of kinds) {
    const rows = active.filter((a) => a.kind === kind).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const preferred = rows.find((a) => a.id === preferId);
    const winner = preferred ?? rows.find((a) => a.isDefault) ?? rows[0]!;
    for (const r of rows) {
      if (r.id === winner.id && !r.isDefault) set.push(r.id);
      if (r.id !== winner.id && r.isDefault) unset.push(r.id);
    }
  }
  return { set, unset };
}

export const SUPPLIER_MAIN_KINDS: readonly AddressKindValue[] = ["OFFICE", "BILLING"];

/** Suppliers keep at least one active office or billing address. */
export function supplierAddressError(active: readonly { kind: AddressKindValue }[]): string | null {
  return active.some((a) => SUPPLIER_MAIN_KINDS.includes(a.kind)) ? null : "A supplier needs at least one office or billing address.";
}
