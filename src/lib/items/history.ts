import { db } from "@/lib/db";
import { ymd } from "@/lib/documents/common";

/**
 * S-55: item list with last cost and price, and per-customer price history.
 * There is no item master table — descriptions are free text on document
 * lines — so history is derived from non-void quote, SO and PO lines,
 * grouped by description (trimmed, case-insensitive, whitespace collapsed).
 */

export type ItemHistoryRow = {
  /** Normalized description, used as the row key. */
  key: string;
  /** Display description (first-seen casing). */
  description: string;
  lastPrice: string | null;
  lastPriceDate: string | null;
  lastPriceRef: string | null;
  lastCost: string | null;
  lastCostDate: string | null;
  lastCostRef: string | null;
};

export type ItemHistoryEntry = {
  description: string;
  date: string;
  ref: string;
  price?: string | null;
  cost?: string | null;
};

export function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Pure grouping: entries must already be newest-first per source. */
export function groupItemHistory(entries: readonly ItemHistoryEntry[]): ItemHistoryRow[] {
  const rows = new Map<string, ItemHistoryRow>();
  for (const entry of entries) {
    const key = normalizeDescription(entry.description);
    if (!key) continue;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        description: entry.description.trim(),
        lastPrice: null,
        lastPriceDate: null,
        lastPriceRef: null,
        lastCost: null,
        lastCostDate: null,
        lastCostRef: null,
      };
      rows.set(key, row);
    }
    if (entry.price != null && row.lastPrice == null) {
      row.lastPrice = entry.price;
      row.lastPriceDate = entry.date;
      row.lastPriceRef = entry.ref;
    }
    if (entry.cost != null && row.lastCost == null) {
      row.lastCost = entry.cost;
      row.lastCostDate = entry.date;
      row.lastCostRef = entry.ref;
    }
  }
  return [...rows.values()];
}

export async function listItemHistory(opts: { q?: string; customerId?: string } = {}): Promise<ItemHistoryRow[]> {
  const { q, customerId } = opts;
  const descFilter = q?.trim() ? { contains: q.trim() } : undefined;
  const [quoteLines, soLines] = await Promise.all([
    db.quoteItem.findMany({
      where: {
        removedAt: null,
        description: descFilter,
        quote: { status: { not: "VOID" }, ...(customerId ? { customerId } : {}) },
      },
      select: {
        description: true,
        unitPrice: true,
        quote: { select: { number: true, date: true } },
      },
      orderBy: [{ quote: { date: "desc" } }, { sortOrder: "asc" }],
      take: 1000,
    }),
    db.salesOrderItem.findMany({
      where: {
        removedAt: null,
        description: descFilter,
        salesOrder: { status: { not: "VOID" }, ...(customerId ? { customerId } : {}) },
      },
      select: {
        description: true,
        unitPrice: true,
        salesOrder: { select: { number: true, date: true } },
      },
      orderBy: [{ salesOrder: { date: "desc" } }, { sortOrder: "asc" }],
      take: 1000,
    }),
  ]);
  // Costs are not per-customer, so the customer tab never asks for them.
  const poLines = customerId
    ? []
    : await db.purchaseOrderItem.findMany({
        where: {
          description: descFilter,
          purchaseOrder: { status: { not: "VOID" } },
        },
        select: {
          description: true,
          unitCost: true,
          purchaseOrder: { select: { number: true, date: true } },
        },
        orderBy: [{ purchaseOrder: { date: "desc" } }],
        take: 1000,
      });
  const entries: ItemHistoryEntry[] = [
    ...quoteLines.map((l) => ({
      description: l.description,
      date: ymd(l.quote.date) ?? "",
      ref: l.quote.number,
      price: String(l.unitPrice),
    })),
    ...soLines.map((l) => ({
      description: l.description,
      date: ymd(l.salesOrder.date) ?? "",
      ref: l.salesOrder.number,
      price: String(l.unitPrice),
    })),
    ...poLines.map((l) => ({
      description: l.description,
      date: ymd(l.purchaseOrder.date) ?? "",
      ref: l.purchaseOrder.number,
      cost: String(l.unitCost),
    })),
  ];
  return groupItemHistory(entries);
}
