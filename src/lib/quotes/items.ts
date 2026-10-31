// Turning submitted item rows into stored rows (shared by quotes and sales orders).

import { lineAmounts, type ItemKind, type LineAmounts } from "./calc";
import type { ItemInput } from "../validation/quotes";
import { lineWithholdingSnapshot } from "./withholding-defaults";

export type StoredItem = {
  id: string;
  kind: ItemKind;
  supplierId: string | null;
  supplierUnitCost: string;
  withholdingRate?: string | null;
  withholdingAtc?: string | null;
  withholdingOverride?: boolean;
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
  withholdingRate: string | null;
  withholdingAtc: string | null;
  withholdingOverride: boolean;
};

export type PlanItemsOpts = {
  /** Customer withholding type used to default new lines when the payload omits rate/ATC. */
  customerWithholdingType?: string | null;
  /** When true, every line is re-snapshotted from the customer type (clears overrides). */
  reapplyWithholding?: boolean;
};

function resolveLineWithholding(
  input: ItemInput,
  old: StoredItem | undefined,
  opts: PlanItemsOpts,
): { withholdingRate: string | null; withholdingAtc: string | null; withholdingOverride: boolean } {
  if (opts.reapplyWithholding) {
    return lineWithholdingSnapshot(opts.customerWithholdingType, input.kind);
  }
  if (input.withholdingRate !== undefined || input.withholdingAtc !== undefined || input.withholdingOverride !== undefined) {
    const rate =
      input.withholdingRate !== undefined && input.withholdingRate !== null && input.withholdingRate !== ""
        ? Number(input.withholdingRate).toFixed(4)
        : "0.0000";
    return {
      withholdingRate: rate,
      withholdingAtc: input.withholdingAtc != null && input.withholdingAtc !== "" ? input.withholdingAtc : null,
      withholdingOverride: input.withholdingOverride ?? false,
    };
  }
  if (old && (old.withholdingRate != null || old.withholdingAtc != null || old.withholdingOverride)) {
    return {
      withholdingRate: old.withholdingRate != null ? Number(old.withholdingRate).toFixed(4) : "0.0000",
      withholdingAtc: old.withholdingAtc ?? null,
      withholdingOverride: old.withholdingOverride ?? false,
    };
  }
  // New line with no payload fields: snapshot from the customer type.
  return lineWithholdingSnapshot(opts.customerWithholdingType, input.kind);
}

/**
 * Users who can't see costs never send them: for their edits, costs on existing
 * lines are kept as they were and new lines start with no supplier and ₱0 cost.
 * Rows of `existing` not in `inputs` are returned in `removedIds` (they get
 * `removedAt`; items are never deleted).
 */
export function planItems(
  existing: readonly StoredItem[],
  inputs: readonly ItemInput[],
  withCosts: boolean,
  opts: PlanItemsOpts = {},
) {
  const used = new Set<string>();
  const items: PlannedItem[] = inputs.map((input, i) => {
    const old = input.id && !used.has(input.id) ? existing.find((e) => e.id === input.id) : undefined;
    if (old) used.add(old.id);
    const supplierId = withCosts ? input.supplierId : (old?.supplierId ?? null);
    const supplierUnitCost = withCosts ? input.supplierUnitCost : (old?.supplierUnitCost ?? "0");
    const wh = resolveLineWithholding(input, old, opts);
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
      ...wh,
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
    withholdingRate: p.withholdingRate,
    withholdingAtc: p.withholdingAtc,
    withholdingOverride: p.withholdingOverride,
  };
}
