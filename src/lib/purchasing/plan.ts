// "Create POs" from a sales order: group the SO lines by supplier, one PO per
// supplier, each line's unit cost copied from the SO line (which copied it from
// the quote line). Pure, so the preview and the server use the same rules.

import type { ItemKind } from "../quotes/calc";
import { fromScaled, toScaled } from "../quotes/calc";

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

export type PoPlanOptions = {
  /** Live ordered qty by SO line id. When set, a line locks only once this covers its SO qty. */
  orderedQty?: Readonly<Record<string, string>>;
  /** Live ordered qty by lot-component id. Same rule as orderedQty. */
  orderedComponentQty?: Readonly<Record<string, string>>;
  /** Qty to order, keyed like supplierPicks. Omitted = the remaining qty. */
  qtyPicks?: Readonly<Record<string, string>>;
};

/** SO qty still not on a live PO. Never negative. */
export function qtyLeft(soQty: string, orderedQty: string): string {
  const rem = toScaled(soQty, 2) - toScaled(orderedQty || "0", 2);
  return fromScaled(rem > 0n ? rem : 0n, 2);
}

function covers(orderedQty: string, soQty: string): boolean {
  return toScaled(orderedQty || "0", 2) >= toScaled(soQty, 2);
}

/**
 * @param ordered ids of SO lines already fully on a live (non-void) PO.
 *   Ignored for a line when `opts.orderedQty` has that line (qty wins).
 * @param supplierPicks supplier chosen in the preview for lines without one (or to override);
 *   keyed by SO line id, or by component id for lot components
 * @param only if given, plan just these SO line ids
 * @param orderedComponents ids of lot components already fully on a live PO.
 *   Ignored for a component when `opts.orderedComponentQty` has it.
 * @param excludeComponents lot component ids unticked in the preview
 */
export function planPurchaseOrders(
  lines: readonly SoLineForPo[],
  ordered: ReadonlySet<string>,
  supplierPicks: Readonly<Record<string, string | null | undefined>> = {},
  only?: ReadonlySet<string>,
  orderedComponents: ReadonlySet<string> = new Set(),
  excludeComponents: ReadonlySet<string> = new Set(),
  opts: PoPlanOptions = {},
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
        const orderedAmt = opts.orderedComponentQty?.[c.id];
        const locked = orderedAmt !== undefined ? covers(orderedAmt, c.qty) : orderedComponents.has(c.id);
        if (locked) continue;
        allOrdered = false;
        const supplierId = supplierPicks[c.id] || c.supplierId;
        const qty = opts.qtyPicks?.[c.id] ?? (orderedAmt !== undefined ? qtyLeft(c.qty, orderedAmt) : c.qty);
        if (!supplierId) {
          // Shaped like a line so the preview's pickers work unchanged;
          // the id is the component id, which is what the pick is keyed by.
          needsSupplier.push({
            id: c.id,
            sortOrder: l.sortOrder,
            description: c.description,
            kind: l.kind,
            qty,
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
          qty,
          unit: c.unit,
          unitCost: c.unitCost,
        });
      }
      if (sawComponent && allOrdered) alreadyOrdered.push(l);
      continue;
    }
    const orderedAmt = opts.orderedQty?.[l.id];
    const locked = orderedAmt !== undefined ? covers(orderedAmt, l.qty) : ordered.has(l.id);
    if (locked) {
      alreadyOrdered.push(l);
      continue;
    }
    const supplierId = supplierPicks[l.id] || l.supplierId;
    const qty = opts.qtyPicks?.[l.id] ?? (orderedAmt !== undefined ? qtyLeft(l.qty, orderedAmt) : l.qty);
    if (!supplierId) {
      needsSupplier.push({ ...l, qty });
      continue;
    }
    push(supplierId, { salesOrderItemId: l.id, description: l.description, kind: l.kind, qty, unit: l.unit, unitCost: l.supplierUnitCost });
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

// ---------------------------------------------------------------------------
// Selection-first create (REQ-PO-FLOW-002 / 003)
// One row per SO line or lot component the buyer ticked. Group by the FINAL
// supplier. Unit cost stays the quote/SO cost — a supplier change does not
// move it. Qty cannot exceed the remaining qty.
// ---------------------------------------------------------------------------

const QTY_RE = /^\d{1,10}(\.\d{1,2})?$/;

export type PoSelectionInput = {
  key: string;
  salesOrderItemId: string;
  salesOrderItemComponentId?: string | null;
  description: string;
  kind: ItemKind;
  /** Qty the buyer wants on this PO. */
  qty: string;
  unit: string;
  /** Quote/SO unit cost. Kept even when the supplier changes. */
  unitCost: string;
  /** Final supplier on the row. Empty when the buyer has not picked one. */
  supplierId: string | null;
  quoteSupplierId: string | null;
  sortOrder: number;
  lotDescription?: string | null;
  confirmZero?: boolean;
  /** SO qty minus qty already on live POs. */
  remainingQty: string;
};

export type SelectedPoLine = PlannedPoLine & {
  key: string;
  quoteSupplierId: string | null;
  sortOrder: number;
  lotDescription: string | null;
  confirmZero: boolean;
};

export type SelectedPo = { supplierId: string; lines: SelectedPoLine[] };

export type PoSelectionIssue = {
  key: string;
  field: "supplier" | "qty" | "cost";
  code: "missing" | "inactive" | "qty" | "zero" | "unknown";
  message: string;
};

export type PoSelectionPlan = { pos: SelectedPo[]; issues: PoSelectionIssue[] };

function money2(value: string): string {
  return fromScaled(toScaled(value, 2), 2);
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Banner for the selection screen / the refused submit. */
export function selectionIssueSummary(issues: readonly PoSelectionIssue[], verb: "review" | "create" = "create"): string {
  const missing = new Set(issues.filter((i) => i.code === "missing").map((i) => i.key)).size;
  const zero = new Set(issues.filter((i) => i.code === "zero").map((i) => i.key)).size;
  const qty = new Set(issues.filter((i) => i.code === "qty" || i.code === "unknown").map((i) => i.key)).size;
  const inactive = new Set(issues.filter((i) => i.code === "inactive").map((i) => i.key)).size;
  const parts: string[] = [];
  if (missing) parts.push(`${missing} line${missing === 1 ? "" : "s"} need${missing === 1 ? "s" : ""} a supplier`);
  if (zero) parts.push(`${zero} line${zero === 1 ? "" : "s"} at ₱0.00 need${zero === 1 ? "s" : ""} a per-line cost confirmation`);
  if (qty) parts.push(`${qty} line${qty === 1 ? "" : "s"} ${qty === 1 ? "has" : "have"} a qty that can't be ordered`);
  if (inactive) parts.push(`${inactive} line${inactive === 1 ? "" : "s"} ${inactive === 1 ? "has" : "have"} an inactive supplier`);
  if (!parts.length) return "Fix the lines marked below.";
  return `Can't ${verb} yet: ${joinAnd(parts)}.`;
}

/**
 * Group ticked rows into one draft PO per final supplier.
 * Rows with a problem are left out of `pos` and listed in `issues`.
 * Cost is copied from `unitCost` and is not affected by `supplierId`.
 */
export function planPoSelection(rows: readonly PoSelectionInput[]): PoSelectionPlan {
  const issues: PoSelectionIssue[] = [];
  const ready: { supplierId: string; line: SelectedPoLine }[] = [];
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  for (const row of sorted) {
    const rowIssues: PoSelectionIssue[] = [];
    const supplierId = row.supplierId?.trim() || "";
    if (!supplierId) {
      rowIssues.push({ key: row.key, field: "supplier", code: "missing", message: "Supplier required — no PO without one" });
    }
    const qtyRaw = row.qty.trim().replace(/,/g, "");
    let qty = "";
    if (!QTY_RE.test(qtyRaw) || toScaled(qtyRaw, 2) <= 0n) {
      rowIssues.push({
        key: row.key,
        field: "qty",
        code: "qty",
        message: QTY_RE.test(qtyRaw) ? "Qty to order must be more than 0. Untick the row to skip it." : "Enter a quantity with up to 2 decimals.",
      });
    } else if (toScaled(qtyRaw, 2) > toScaled(row.remainingQty || "0", 2)) {
      const left = qtyLeft(row.remainingQty || "0", "0");
      rowIssues.push({
        key: row.key,
        field: "qty",
        code: "qty",
        message:
          toScaled(row.remainingQty || "0", 2) <= 0n
            ? "This line is already fully ordered."
            : `Qty can't be more than the ${left.replace(/\.00$/, "")} left to order.`,
      });
    } else {
      qty = money2(qtyRaw);
    }
    let unitCost = "0.00";
    try {
      unitCost = money2(row.unitCost || "0");
    } catch {
      rowIssues.push({ key: row.key, field: "cost", code: "unknown", message: "This line's unit cost is not a valid amount." });
    }
    if (toScaled(unitCost, 2) === 0n && !row.confirmZero) {
      rowIssues.push({ key: row.key, field: "cost", code: "zero", message: "Confirm the ₱0.00 cost or untick this row" });
    }
    issues.push(...rowIssues);
    if (rowIssues.length || !supplierId || !qty) continue;
    ready.push({
      supplierId,
      line: {
        key: row.key,
        salesOrderItemId: row.salesOrderItemId,
        salesOrderItemComponentId: row.salesOrderItemComponentId ?? null,
        description: row.description,
        kind: row.kind,
        qty,
        unit: row.unit,
        unitCost,
        quoteSupplierId: row.quoteSupplierId,
        sortOrder: row.sortOrder,
        lotDescription: row.lotDescription ?? null,
        confirmZero: !!row.confirmZero,
      },
    });
  }
  const bySupplier = new Map<string, SelectedPoLine[]>();
  for (const item of ready) {
    const list = bySupplier.get(item.supplierId) ?? [];
    list.push(item.line);
    bySupplier.set(item.supplierId, list);
  }
  return { pos: [...bySupplier].map(([supplierId, lines]) => ({ supplierId, lines })), issues };
}
