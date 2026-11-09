// "Create POs" from a sales order: group the SO lines by supplier, one PO per
// supplier, each line's unit cost copied from the SO line (which copied it from
// the quote line). Pure, so the preview and the server use the same rules.

import type { ItemKind } from "../quotes/calc";
import { toScaled } from "../quotes/calc";

export type SoComponentForPo = {
  id: string;
  sortOrder: number;
  description: string;
  qty: string;
  unit: string;
  supplierId: string | null;
  unitCost: string;
};

export type SoLineForPo = {
  id: string;
  sortOrder: number;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierUnitCost: string;
  /** Lot (bundle) line: POs are built from its components, never the line. */
  isLot?: boolean;
  components?: readonly SoComponentForPo[];
};

export type PlannedPoLine = {
  salesOrderItemId: string;
  /** Set when this PO line buys one lot component of the SO line above. */
  salesOrderItemComponentId?: string | null;
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
 * @param supplierPicks supplier chosen in the preview for lines without one (or to override);
 *   keyed by SO line id, or by component id for lot components
 * @param only if given, plan just these SO line ids
 * @param orderedComponents ids of lot components already on a live PO line
 * @param excludeComponents lot component ids unticked in the preview
 */
export function planPurchaseOrders(
  lines: readonly SoLineForPo[],
  ordered: ReadonlySet<string>,
  supplierPicks: Readonly<Record<string, string | null | undefined>> = {},
  only?: ReadonlySet<string>,
  orderedComponents: ReadonlySet<string> = new Set(),
  excludeComponents: ReadonlySet<string> = new Set(),
): PoPlan {
  const bySupplier = new Map<string, PlannedPoLine[]>();
  const needsSupplier: SoLineForPo[] = [];
  const alreadyOrdered: SoLineForPo[] = [];
  const push = (supplierId: string, line: PlannedPoLine) => {
    const list = bySupplier.get(supplierId) ?? [];
    list.push(line);
    bySupplier.set(supplierId, list);
  };
  for (const l of [...lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (only && !only.has(l.id)) continue;
    if (l.isLot) {
      // A lot line is never bought itself: each component becomes a PO line
      // under the component's own supplier (or a preview pick).
      let sawComponent = false;
      let allOrdered = true;
      for (const c of [...(l.components ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (excludeComponents.has(c.id)) continue;
        sawComponent = true;
        if (orderedComponents.has(c.id)) continue;
        allOrdered = false;
        const supplierId = supplierPicks[c.id] || c.supplierId;
        if (!supplierId) {
          // Shaped like a line so the preview's pickers work unchanged;
          // the id is the component id, which is what the pick is keyed by.
          needsSupplier.push({
            id: c.id,
            sortOrder: l.sortOrder,
            description: c.description,
            kind: l.kind,
            qty: c.qty,
            unit: c.unit,
            supplierId: null,
            supplierUnitCost: c.unitCost,
          });
          continue;
        }
        push(supplierId, {
          salesOrderItemId: l.id,
          salesOrderItemComponentId: c.id,
          description: c.description,
          kind: l.kind,
          qty: c.qty,
          unit: c.unit,
          unitCost: c.unitCost,
        });
      }
      if (sawComponent && allOrdered) alreadyOrdered.push(l);
      continue;
    }
    if (ordered.has(l.id)) {
      alreadyOrdered.push(l);
      continue;
    }
    const supplierId = supplierPicks[l.id] || l.supplierId;
    if (!supplierId) {
      needsSupplier.push(l);
      continue;
    }
    push(supplierId, { salesOrderItemId: l.id, description: l.description, kind: l.kind, qty: l.qty, unit: l.unit, unitCost: l.supplierUnitCost });
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
