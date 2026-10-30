// Turning submitted item rows into stored rows (shared by quotes and sales orders).

import { lineAmounts, type ItemKind, type LineAmounts } from "./calc";
import type { ItemInput } from "../validation/quotes";

export type StoredItem = {
  id: string;
  kind: ItemKind;
  supplierId: string | null;
  supplierUnitCost: string;
};

export type PlannedItem = LineAmounts & {
  /** Existing row to update, or null for a new row. */
  id: string | null;
  sortOrder: number;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierUnitCost: string;
  unitPrice: string;
};

/**
 * Users who can't see costs never send them: for their edits, costs on existing
 * lines are kept as they were and new lines start with no supplier and ₱0 cost.
 * Rows of `existing` not in `inputs` are returned in `removedIds` (they get
 * `removedAt`; items are never deleted).
 */
export function planItems(existing: readonly StoredItem[], inputs: readonly ItemInput[], withCosts: boolean) {
  const used = new Set<string>();
  const items: PlannedItem[] = inputs.map((input, i) => {
    const old = input.id && !used.has(input.id) ? existing.find((e) => e.id === input.id) : undefined;
    if (old) used.add(old.id);
    const supplierId = withCosts ? input.supplierId : (old?.supplierId ?? null);
    const supplierUnitCost = withCosts ? input.supplierUnitCost : (old?.supplierUnitCost ?? "0");
    return {
      id: old?.id ?? null,
      sortOrder: i + 1,
      description: input.description,
      kind: input.kind,
      qty: input.qty,
      unit: input.unit,
      supplierId,
      supplierUnitCost,
      unitPrice: input.unitPrice,
      ...lineAmounts({ kind: input.kind, qty: input.qty, unitPrice: input.unitPrice, supplierUnitCost }),
    };
  });
  const removedIds = existing.filter((e) => !used.has(e.id)).map((e) => e.id);
  return { items, removedIds };
}

/** Row data for Prisma create/update. */
export function itemData(p: PlannedItem) {
  return {
    sortOrder: p.sortOrder,
    description: p.description,
    kind: p.kind,
    qty: p.qty,
    unit: p.unit,
    supplierId: p.supplierId,
    supplierUnitCost: p.supplierUnitCost,
    unitPrice: p.unitPrice,
    total: p.total,
    supplierTotal: p.supplierTotal,
    margin: p.margin,
  };
}
