// "Create POs" from a sales order: group the SO lines by supplier, one PO per
// supplier, each line's unit cost copied from the SO line (which copied it from
// the quote line). Pure, so the preview and the server use the same rules.

import type { ItemKind } from "../quotes/calc";
import { toScaled } from "../quotes/calc";

export type SoLineForPo = {
  id: string;
  sortOrder: number;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierUnitCost: string;
};

export type PlannedPoLine = {
  salesOrderItemId: string;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  unitCost: string;
};

export type PlannedPo = { supplierId: string; lines: PlannedPoLine[] };

export type PoPlan = {
  pos: PlannedPo[];
  /** Lines with no supplier (pick one in the preview, or they're skipped). */
  needsSupplier: SoLineForPo[];
  /** Lines already on a non-void PO. */
  alreadyOrdered: SoLineForPo[];
};

/**
 * @param ordered ids of SO lines already on a live (non-void) PO line
 * @param supplierPicks supplier chosen in the preview for lines without one (or to override)
 * @param only if given, plan just these SO line ids
 */
export function planPurchaseOrders(
  lines: readonly SoLineForPo[],
  ordered: ReadonlySet<string>,
  supplierPicks: Readonly<Record<string, string | null | undefined>> = {},
  only?: ReadonlySet<string>,
): PoPlan {
  const bySupplier = new Map<string, PlannedPoLine[]>();
  const needsSupplier: SoLineForPo[] = [];
  const alreadyOrdered: SoLineForPo[] = [];
  for (const l of [...lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (only && !only.has(l.id)) continue;
    if (ordered.has(l.id)) {
      alreadyOrdered.push(l);
      continue;
    }
    const supplierId = supplierPicks[l.id] || l.supplierId;
    if (!supplierId) {
      needsSupplier.push(l);
      continue;
    }
    const list = bySupplier.get(supplierId) ?? [];
    list.push({ salesOrderItemId: l.id, description: l.description, kind: l.kind, qty: l.qty, unit: l.unit, unitCost: l.supplierUnitCost });
    bySupplier.set(supplierId, list);
  }
  return { pos: [...bySupplier].map(([supplierId, l]) => ({ supplierId, lines: l })), needsSupplier, alreadyOrdered };
}

/** Warning when the PO quantities for a SO line don't add up to the SO quantity. */
export function qtyMismatch(soQty: string, poQtys: readonly string[]): string | null {
  const total = poQtys.reduce((acc, q) => acc + toScaled(q, 2), 0n);
  const so = toScaled(soQty, 2);
  if (total === so) return null;
  return total > so ? "PO qty is more than the SO qty." : "PO qty is less than the SO qty.";
}
