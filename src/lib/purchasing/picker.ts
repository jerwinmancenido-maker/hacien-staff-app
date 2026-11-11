// "Add from sales order" picker rows for the PO editor (Part B of the SO+PO
// editability plan). Pure builder: the PO edit page feeds it the SO's lines
// and lot components plus the live ordered qty (loadOrderedQty — the ONE
// ordered-qty helper, audit B4); the editor renders the rows and the service
// re-checks everything server-side on save.
//
// Rules (plan Part B + Jerwin's settlements):
// - Lot lines themselves are never pickable; their components are.
// - A row appears only while some qty is still unordered (remaining > 0) and
//   the line is not already linked on THIS PO (edit that line in place).
// - Supplier state: same supplier as the PO -> "addable"; no supplier ->
//   "no-supplier" (it takes the PO's supplier); a different supplier ->
//   "other-supplier" (shown greyed; it belongs on its own PO).
// - Over-ordering beyond the remaining qty is a WARNING, never a block
//   (deliberate extras); the editor warns live and the service records it.

import { qtyLeft } from "./plan";
import { toScaled } from "../quotes/calc";
import type { ItemKind } from "../quotes/calc";

export type SoPickerLineInput = {
  id: string;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: string;
  isLot: boolean;
  components: readonly {
    id: string;
    description: string;
    qty: string;
    unit: string;
    supplierId: string | null;
    supplierName: string | null;
    unitCost: string;
  }[];
};

export type SoPickerRow = {
  /** SO line id, or lot-component id. */
  key: string;
  isComponent: boolean;
  /** Lot line's description, for component rows. */
  parentDescription: string | null;
  description: string;
  kind: ItemKind;
  unit: string;
  soQty: string;
  orderedQty: string;
  remainingQty: string;
  unitCost: string;
  supplierId: string | null;
  supplierName: string | null;
  state: "addable" | "no-supplier" | "other-supplier";
};

export function buildSoPickerRows(input: {
  lines: readonly SoPickerLineInput[];
  /** Live ordered qty by SO line id / component id (loadOrderedQty buckets). */
  orderedLines: ReadonlyMap<string, { qty: string }>;
  orderedComponents: ReadonlyMap<string, { qty: string }>;
  /** The PO's supplier — the picker only adds lines that can join THIS PO. */
  poSupplierId: string;
  /** Link keys already on this PO (edit those lines in place instead). */
  onThisPo: ReadonlySet<string>;
}): SoPickerRow[] {
  const rows: SoPickerRow[] = [];
  const state = (supplierId: string | null): SoPickerRow["state"] =>
    supplierId === null ? "no-supplier" : supplierId === input.poSupplierId ? "addable" : "other-supplier";
  for (const line of input.lines) {
    if (line.isLot) {
      for (const c of line.components) {
        if (input.onThisPo.has(c.id)) continue;
        const orderedQty = input.orderedComponents.get(c.id)?.qty ?? "0.00";
        const remainingQty = qtyLeft(c.qty, orderedQty);
        if (toScaled(remainingQty, 2) <= 0n) continue;
        rows.push({
          key: c.id,
          isComponent: true,
          parentDescription: line.description,
          description: c.description,
          // Components carry no kind of their own in the picker; they buy as
          // goods lines, matching Create-POs (PlannedPoLine for components).
          kind: "GOODS",
          unit: c.unit,
          soQty: c.qty,
          orderedQty,
          remainingQty,
          unitCost: c.unitCost,
          supplierId: c.supplierId,
          supplierName: c.supplierName,
          state: state(c.supplierId),
        });
      }
      continue;
    }
    if (input.onThisPo.has(line.id)) continue;
    const orderedQty = input.orderedLines.get(line.id)?.qty ?? "0.00";
    const remainingQty = qtyLeft(line.qty, orderedQty);
    if (toScaled(remainingQty, 2) <= 0n) continue;
    rows.push({
      key: line.id,
      isComponent: false,
      parentDescription: null,
      description: line.description,
      kind: line.kind,
      unit: line.unit,
      soQty: line.qty,
      orderedQty,
      remainingQty,
      unitCost: line.unitCost,
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      state: state(line.supplierId),
    });
  }
  return rows;
}

/** True when a qty goes past what the sales order still needs (a warning). */
export function overOrder(qty: string, remainingQty: string): boolean {
  return toScaled(qty || "0", 2) > toScaled(remainingQty || "0", 2);
}
