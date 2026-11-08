// Turning submitted item rows into stored rows (shared by quotes and sales orders).

import { componentsTotal, fromScaled, lineAmounts, toScaled, type ItemKind, type LineAmounts, type WithholdingSnapshot } from "./calc";
import type { ItemInput } from "../validation/quotes";
import { lineWithholdingSnapshotFromPicks } from "./withholding-defaults";

/** One internal component of a lot (bundle) line, as planned for storage. */
export type PlannedComponent = {
  itemId: string | null;
  description: string;
  qty: string;
  unit: string;
  supplierId: string | null;
  unitCost: string;
};

export type StoredItem = {
  id: string;
  kind: ItemKind;
  supplierId: string | null;
  supplierUnitCost: string;
  /** Lot lines: stored flag + components, so a no-costs save can keep them. */
  isLot?: boolean;
  components?: readonly PlannedComponent[];
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
  /** Catalog Step 3: the linked catalog item, or null for a free-text line. */
  itemId: string | null;
  /** Lot (bundle) line: cost comes from components; supplierUnitCost is "0". */
  isLot: boolean;
  components: PlannedComponent[];
  supplierUnitCost: string;
  unitPrice: string;
  withholdingRate: string | null;
  withholdingAtc: string | null;
  withholdingOverride: boolean;
};

export type PlanItemsOpts = {
  /**
   * Document-level withholding pick resolved to rate snapshots.
   * Empty array = explicit none; omitted/undefined with no reapply keeps
   * submitted / stored line values.
   */
  withholdingPicks?: readonly WithholdingSnapshot[];
  /**
   * When true, non-override lines are re-snapshotted from withholdingPicks.
   * Lines with withholdingOverride=true keep their submitted rate/ATC/flag.
   */
  reapplyWithholding?: boolean;
  /** Lot (bundle) lines are a quotes-only feature: only the quote service
   * passes true. Sales orders share planItems but never plan lots (their
   * components arrive with conversion, a separate step). */
  lots?: boolean;
};

function fromInputFields(input: ItemInput): { withholdingRate: string | null; withholdingAtc: string | null; withholdingOverride: boolean } {
  const rate =
    input.withholdingRate === null || input.withholdingRate === ""
      ? null
      : input.withholdingRate !== undefined
        ? Number(input.withholdingRate).toFixed(4)
        : "0.0000";
  return {
    withholdingRate: rate,
    withholdingAtc: input.withholdingAtc != null && input.withholdingAtc !== "" ? input.withholdingAtc : null,
    withholdingOverride: input.withholdingOverride ?? false,
  };
}

function resolveLineWithholding(
  input: ItemInput,
  old: StoredItem | undefined,
  opts: PlanItemsOpts,
): { withholdingRate: string | null; withholdingAtc: string | null; withholdingOverride: boolean } {
  const picks = opts.withholdingPicks ?? [];
  if (opts.reapplyWithholding) {
    // Manual overrides survive re-apply (UI + server share this rule).
    if (input.withholdingOverride === true) return fromInputFields(input);
    return lineWithholdingSnapshotFromPicks(picks, input.kind);
  }
  if (input.withholdingRate !== undefined || input.withholdingAtc !== undefined || input.withholdingOverride !== undefined) {
    return fromInputFields(input);
  }
  if (old && (old.withholdingRate != null || old.withholdingAtc != null || old.withholdingOverride)) {
    return {
      withholdingRate: old.withholdingRate != null ? Number(old.withholdingRate).toFixed(4) : null,
      withholdingAtc: old.withholdingAtc ?? null,
      withholdingOverride: old.withholdingOverride ?? false,
    };
  }
  // New line with no payload fields: snapshot from the document pick.
  return lineWithholdingSnapshotFromPicks(picks, input.kind);
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
    // A cleared box is the same ₱0 as a typed 0.00, so the approval compare sees the clear.
    const typedCost = String(input.supplierUnitCost ?? "").trim();
    const supplierUnitCost = withCosts ? (typedCost === "" ? "0" : typedCost) : (old?.supplierUnitCost ?? "0");
    const wh = resolveLineWithholding(input, old, opts);
    // Lot (bundle) lines: the line's cost is the sum of its components and
    // its own supplier/cost stay empty. A costs user plans lots from the
    // payload; a no-costs save keeps a stored lot exactly as it was.
    const lotFromInput = opts.lots === true && withCosts && input.isLot === true;
    const lotFromStored = !withCosts && old?.isLot === true;
    const isLot = lotFromInput || lotFromStored;
    let components: PlannedComponent[] = [];
    if (lotFromInput) {
      components = (input.components ?? []).map((c) => ({
        itemId: c.itemId || null,
        description: c.description,
        qty: c.qty,
        unit: c.unit,
        supplierId: c.supplierId ?? null,
        unitCost: String(c.unitCost ?? "").trim() === "" ? "0" : String(c.unitCost),
      }));
    } else if (lotFromStored) {
      components = (old?.components ?? []).map((c) => ({ ...c }));
    }
    let amounts: LineAmounts;
    if (isLot) {
      const base = lineAmounts({ kind: input.kind, qty: input.qty, unitPrice: input.unitPrice, supplierUnitCost: "0" });
      const supplierTotal = componentsTotal(components);
      amounts = {
        total: base.total,
        supplierTotal,
        margin: fromScaled(toScaled(base.total, 2) - toScaled(supplierTotal, 2), 2),
      };
    } else {
      amounts = lineAmounts({ kind: input.kind, qty: input.qty, unitPrice: input.unitPrice, supplierUnitCost });
    }
    return {
      id: old?.id ?? null,
      sortOrder: i + 1,
      description: input.description,
      kind: input.kind,
      qty: input.qty,
      unit: input.unit,
      // The editor always sends itemId (null = unlinked); null/"" clears a link.
      itemId: input.itemId || null,
      supplierId: isLot ? null : supplierId,
      supplierUnitCost: isLot ? "0" : supplierUnitCost,
      isLot,
      components,
      unitPrice: input.unitPrice,
      ...amounts,
      ...wh,
    };
  });
  const removedIds = existing.filter((e) => !used.has(e.id)).map((e) => e.id);
  return { items, removedIds };
}

/** Row data for a Prisma quote-item-component create. */
export function componentData(c: PlannedComponent) {
  return {
    itemId: c.itemId,
    description: c.description,
    qty: c.qty,
    unit: c.unit,
    supplierId: c.supplierId,
    unitCost: c.unitCost,
  };
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
