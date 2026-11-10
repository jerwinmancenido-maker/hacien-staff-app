// Live ordered qty for "Create POs". Sums every non-void, non-removed PO line
// linked to the SO line or lot component. The unique activeSalesOrderItem*
// columns stay a single claim token; remainder lines still count here via the
// non-unique salesOrderItemId / salesOrderItemComponentId links.

import type { Tx, Db } from "../db";
import { fromScaled, toScaled } from "../quotes/calc";

type Client = Tx | Db;

export type PoQtyRef = { id: string; number: string; qty: string };

export type OrderedBucket = {
  /** Sum of live PO qty for this line or component. */
  qty: string;
  /** One entry per PO that holds some of that qty, first-seen order. */
  purchaseOrders: PoQtyRef[];
};

type Acc = { scaled: bigint; pos: Map<string, { id: string; number: string; scaled: bigint }> };

function add(map: Map<string, Acc>, id: string, qty: { toFixed(n: number): string } | string, po: { id: string; number: string }) {
  const cur = map.get(id) ?? { scaled: 0n, pos: new Map() };
  const q = toScaled(typeof qty === "string" ? qty : qty.toFixed(2), 2);
  cur.scaled += q;
  const slot = cur.pos.get(po.id) ?? { id: po.id, number: po.number, scaled: 0n };
  slot.scaled += q;
  cur.pos.set(po.id, slot);
  map.set(id, cur);
}

function finish(map: Map<string, Acc>): Map<string, OrderedBucket> {
  const out = new Map<string, OrderedBucket>();
  for (const [id, cur] of map) {
    out.set(id, {
      qty: fromScaled(cur.scaled, 2),
      purchaseOrders: [...cur.pos.values()].map((p) => ({ id: p.id, number: p.number, qty: fromScaled(p.scaled, 2) })),
    });
  }
  return out;
}

const live = { removedAt: null, purchaseOrder: { status: { not: "VOID" as const } } };

/**
 * Ordered qty for plain SO lines (component PO lines are excluded — a lot is
 * not bought as the parent line) and for lot components.
 */
export async function loadOrderedQty(lineIds: readonly string[], componentIds: readonly string[], client: Client) {
  const lineRows = lineIds.length
    ? await client.purchaseOrderItem.findMany({
        where: { salesOrderItemId: { in: [...lineIds] }, salesOrderItemComponentId: null, ...live },
        select: { salesOrderItemId: true, qty: true, purchaseOrder: { select: { id: true, number: true } } },
      })
    : [];
  const compRows = componentIds.length
    ? await client.purchaseOrderItem.findMany({
        where: { salesOrderItemComponentId: { in: [...componentIds] }, ...live },
        select: { salesOrderItemComponentId: true, qty: true, purchaseOrder: { select: { id: true, number: true } } },
      })
    : [];
  const lines = new Map<string, Acc>();
  for (const row of lineRows) if (row.salesOrderItemId) add(lines, row.salesOrderItemId, row.qty, row.purchaseOrder);
  const components = new Map<string, Acc>();
  for (const row of compRows) if (row.salesOrderItemComponentId) add(components, row.salesOrderItemComponentId, row.qty, row.purchaseOrder);
  return { lines: finish(lines), components: finish(components) };
}
