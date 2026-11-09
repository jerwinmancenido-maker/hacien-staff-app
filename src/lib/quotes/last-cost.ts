// Lot plan Phase A — supplier cost auto-fill helpers.
//
// When a quote line has a supplier and a description but no cost yet, the
// editor fills the cost from that supplier's last PO for the same
// description (the same derivation as the item's Suppliers tab, from
// src/lib/items/history.ts). These pure helpers hold the fill rules so
// they can be unit-tested without the editor.

import { formatPeso } from "@/lib/format";

/** One supplier's last cost for an item description (API row shape). */
export type SupplierCostRow = {
  supplierId: string;
  supplierName: string;
  lastCost: string;
  lastCostDate: string;
  poNumber: string;
};

/** A cost box counts as empty when blank or zero. Non-numeric text is NOT
 * empty — auto-fill never overwrites something staff typed. Thousands
 * commas from the money input are ignored. */
export function costIsEmpty(value: string): boolean {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return true;
  const n = Number(cleaned);
  return Number.isFinite(n) && n === 0;
}

/** The row for the picked supplier, or null when that supplier has no
 * PO history for the description. */
export function pickSupplierCost(rows: readonly SupplierCostRow[], supplierId: string): SupplierCostRow | null {
  return rows.find((r) => r.supplierId === supplierId) ?? null;
}

/** Hint shown under the cost box after a fill (or an available match). */
export function lastCostHint(row: SupplierCostRow): string {
  return `Last cost ${formatPeso(row.lastCost)} · ${row.poNumber} · ${row.lastCostDate}`;
}
