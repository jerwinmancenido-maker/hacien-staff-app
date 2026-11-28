// Same-rate drift warning (ERP adoption item 6, run 103) — warn, NEVER
// block, when a purchase-order line's unit cost differs from the cost agreed
// upstream on the sales order line it is linked to. This moves the warning
// to PO creation/editing; the bill-time 3-way match PRICE_DIFFERS flag
// (src/lib/purchasing/match.ts) stays as the later guard and is untouched.
//
// THE RULE:
// - A PO line linked to an SO line compares against SalesOrderItem
//   .supplierUnitCost; a line linked to a lot component compares against
//   SalesOrderItemComponent.unitCost. Comparison is at centavo precision —
//   an exact match warns about nothing.
// - A PO line with NO SO link (standalone PO, or a hand-added line) has no
//   upstream agreed price — the PO itself is the first agreement — so it
//   never drifts and never warns. There is deliberately no last-PO-cost
//   fallback: quotes/last-cost.ts derives last cost only as an editor
//   auto-fill for quote lines, and a PO line carries no item link to key
//   such a derivation on.

import type { Db, Tx } from "../db";
import { formatPeso } from "../format";
import { toScaled } from "../quotes/calc";

type Client = Tx | Db;

export type CostDrift = {
  /** "higher" = the PO pays more than the SO agreed; "lower" = less. */
  direction: "higher" | "lower";
  /** Difference vs the SO cost, one decimal ("20.0"). Null when the SO cost
   * is ₱0.00 — a percentage of nothing is meaningless, so the wording names
   * the missing cost instead. */
  pct: string | null;
};

export type CostDriftEntry = CostDrift & {
  description: string;
  poUnitCost: string;
  soUnitCost: string;
};

/** Centavo-precision comparison that never throws on half-typed editor
 * input: unparseable counts as NO drift (the save's own validation reports
 * the bad number separately). */
export function costDrift(poUnitCost: string, soUnitCost: string): CostDrift | null {
  let po: bigint;
  let so: bigint;
  try {
    po = toScaled((poUnitCost || "0").replace(/,/g, ""), 2);
    so = toScaled((soUnitCost || "0").replace(/,/g, ""), 2);
  } catch {
    return null;
  }
  if (po === so) return null;
  const direction = po > so ? "higher" : "lower";
  if (so === 0n) return { direction, pct: null };
  const diff = po > so ? po - so : so - po;
  // Tenths of a percent, rounded half up: (diff / so) * 1000.
  const tenths = (diff * 1000n + so / 2n) / so;
  return { direction, pct: `${tenths / 10n}.${tenths % 10n}` };
}

function firstLine(description: string): string {
  const line = (description.split("\n")[0] ?? "").trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || "(no description)";
}

/** The facts of one drift, naming both prices and the difference. The
 * editor's inline warning prefixes this with "Cost differs from the sales
 * order — "; the save-time warning prefixes it with the line's name. */
export function driftDetailText(entry: CostDriftEntry): string {
  // Editor values can carry comma grouping ("1,200") — strip before the
  // peso formatter, which would otherwise print ₱NaN.
  const po = formatPeso(entry.poUnitCost.replace(/,/g, ""));
  const so = formatPeso(entry.soUnitCost.replace(/,/g, ""));
  if (entry.pct === null) {
    return `the sales order has no cost set for this line (SO ${so}), but the PO cost is ${po}`;
  }
  return `PO cost ${po} vs sales order ${so} — ${entry.pct}% ${entry.direction}`;
}

/** One line's save-time warning sentence. */
export function driftLineText(entry: CostDriftEntry): string {
  return `"${firstLine(entry.description)}": ${driftDetailText(entry)}.`;
}

/** The save-time warning (house pattern, PR #360): nothing is saved until
 * the user confirms with "Save anyway". */
export function driftWarningMessage(entries: readonly CostDriftEntry[]): string {
  const head =
    entries.length === 1
      ? "One line cost differs from the sales order. Nothing has been saved yet."
      : `${entries.length} line costs differ from the sales order. Nothing has been saved yet.`;
  return `${head} ${entries.map(driftLineText).join(" ")} Save anyway to keep these costs.`;
}

/** Drift entries for editor-shaped lines (the PO editor carries the SO cost
 * it loaded on each linked line). Lines without an SO cost never drift. */
export function driftEntriesFor(
  lines: readonly { description: string; unitCost: string; soUnitCost?: string | null }[],
): CostDriftEntry[] {
  const out: CostDriftEntry[] = [];
  for (const line of lines) {
    if (line.soUnitCost == null) continue;
    const drift = costDrift(line.unitCost, line.soUnitCost);
    if (drift) out.push({ ...drift, description: line.description, poUnitCost: line.unitCost, soUnitCost: line.soUnitCost });
  }
  return out;
}

type DriftInputLine = {
  id?: string | null;
  description: string;
  unitCost: string;
  salesOrderItemId?: string | null;
  salesOrderItemComponentId?: string | null;
};

/**
 * Server-side drift for a PO save (create or update). Links resolve the way
 * the save itself treats them: an EXISTING line keeps the link it was
 * created with (the stored row wins over the payload), a NEW line uses the
 * payload's link ids. Unlinked lines are skipped by the rule above.
 */
export async function findPoCostDrift(client: Client, poId: string | null, items: readonly DriftInputLine[]): Promise<CostDriftEntry[]> {
  const storedLink = new Map<string, { lineId: string | null; componentId: string | null }>();
  const existingIds = items.map((i) => i.id).filter((v): v is string => !!v);
  if (poId && existingIds.length) {
    const rows = await client.purchaseOrderItem.findMany({
      where: { purchaseOrderId: poId, id: { in: existingIds } },
      select: { id: true, salesOrderItemId: true, salesOrderItemComponentId: true },
    });
    for (const r of rows) storedLink.set(r.id, { lineId: r.salesOrderItemId, componentId: r.salesOrderItemComponentId });
  }

  const resolved = items.map((item) => {
    const stored = item.id ? storedLink.get(item.id) : undefined;
    return {
      item,
      lineId: stored ? stored.lineId : (item.salesOrderItemId ?? null),
      componentId: stored ? stored.componentId : (item.salesOrderItemComponentId ?? null),
    };
  });
  const lineIds = [...new Set(resolved.map((r) => r.lineId).filter((v): v is string => !!v))];
  const componentIds = [...new Set(resolved.map((r) => r.componentId).filter((v): v is string => !!v))];
  if (!lineIds.length && !componentIds.length) return [];

  const [soLines, soComponents] = await Promise.all([
    lineIds.length
      ? client.salesOrderItem.findMany({ where: { id: { in: lineIds } }, select: { id: true, supplierUnitCost: true } })
      : Promise.resolve([] as { id: string; supplierUnitCost: { toFixed(n: number): string } }[]),
    componentIds.length
      ? client.salesOrderItemComponent.findMany({ where: { id: { in: componentIds } }, select: { id: true, unitCost: true } })
      : Promise.resolve([] as { id: string; unitCost: { toFixed(n: number): string } }[]),
  ]);
  const lineCost = new Map(soLines.map((l) => [l.id, l.supplierUnitCost.toFixed(2)]));
  const componentCost = new Map(soComponents.map((c) => [c.id, c.unitCost.toFixed(2)]));

  const out: CostDriftEntry[] = [];
  for (const { item, lineId, componentId } of resolved) {
    const soUnitCost = (componentId ? componentCost.get(componentId) : lineId ? lineCost.get(lineId) : undefined) ?? null;
    if (soUnitCost == null) continue;
    const drift = costDrift(item.unitCost, soUnitCost);
    if (drift) out.push({ ...drift, description: item.description, poUnitCost: item.unitCost, soUnitCost });
  }
  return out;
}
