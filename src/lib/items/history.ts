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

/** One document line for an item detail: which document it came from, so the detail can link to it. */
export type ItemHistoryDetailEntry = ItemHistoryEntry & {
  docKind: "quote" | "sales_order" | "purchase_order";
  docId: string;
};

/** One document in the where-used list: a document appears once no matter how many lines of the item it has. */
export type ItemHistoryDocument = {
  docKind: "quote" | "sales_order" | "purchase_order";
  docId: string;
  docNumber: string;
  date: string;
};

/** Pure grouping: newest-first entries collapse to one row per document. */
export function groupItemDocuments(entries: readonly ItemHistoryDetailEntry[]): ItemHistoryDocument[] {
  const seen = new Map<string, ItemHistoryDocument>();
  for (const entry of entries) {
    const key = `${entry.docKind}:${entry.docId}`;
    if (!seen.has(key)) {
      seen.set(key, { docKind: entry.docKind, docId: entry.docId, docNumber: entry.ref, date: entry.date });
    }
  }
  return [...seen.values()];
}

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

export type SupplierPriceRow = {
  supplierId: string;
  supplierName: string;
  lastCost: string;
  lastCostDate: string;
  poNumber: string;
};

export type SupplierPriceEntry = {
  supplierId: string;
  supplierName: string;
  description: string;
  date: string;
  poNumber: string;
  cost: string;
};

/** Pure grouping: newest PO line per supplier wins (entries newest-first). */
export function groupSupplierPrices(entries: readonly SupplierPriceEntry[]): SupplierPriceRow[] {
  const rows = new Map<string, SupplierPriceRow>();
  for (const entry of entries) {
    if (!rows.has(entry.supplierId)) {
      rows.set(entry.supplierId, {
        supplierId: entry.supplierId,
        supplierName: entry.supplierName,
        lastCost: entry.cost,
        lastCostDate: entry.date,
        poNumber: entry.poNumber,
      });
    }
  }
  return [...rows.values()].sort((a, b) => Number(a.lastCost) - Number(b.lastCost));
}

/**
 * S-56: supplier price compare for one item. Matches the normalized
 * description exactly (a contains-search would also match longer names).
 */
export async function listSupplierPriceComparison(description: string): Promise<SupplierPriceRow[]> {
  const want = normalizeDescription(description);
  if (!want) return [];
  const lines = await db.purchaseOrderItem.findMany({
    where: {
      description: { contains: description.trim() },
      purchaseOrder: { status: { not: "VOID" } },
    },
    select: {
      description: true,
      unitCost: true,
      purchaseOrder: {
        select: { number: true, date: true, supplier: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ purchaseOrder: { date: "desc" } }],
    take: 1000,
  });
  return groupSupplierPrices(
    lines
      .filter((l) => normalizeDescription(l.description) === want)
      .map((l) => ({
        supplierId: l.purchaseOrder.supplier.id,
        supplierName: l.purchaseOrder.supplier.name,
        description: l.description,
        date: ymd(l.purchaseOrder.date) ?? "",
        poNumber: l.purchaseOrder.number,
        cost: String(l.unitCost),
      })),
  );
}

/**
 * Step 2: every document line for one item, newest first, with the document
 * it came from. Matches the normalized description exactly (the same rule
 * as the supplier compare) — a contains-search would also match longer names.
 * Used by the catalog item detail and the history-only detail.
 */
export async function listItemDetailEntries(description: string): Promise<ItemHistoryDetailEntry[]> {
  const want = normalizeDescription(description);
  if (!want) return [];
  const like = { contains: description.trim() };
  const [quoteLines, soLines, poLines] = await Promise.all([
    db.quoteItem.findMany({
      where: { removedAt: null, description: like, quote: { status: { not: "VOID" } } },
      select: {
        description: true,
        unitPrice: true,
        quote: { select: { id: true, number: true, date: true } },
      },
      orderBy: [{ quote: { date: "desc" } }],
      take: 1000,
    }),
    db.salesOrderItem.findMany({
      where: { removedAt: null, description: like, salesOrder: { status: { not: "VOID" } } },
      select: {
        description: true,
        unitPrice: true,
        salesOrder: { select: { id: true, number: true, date: true } },
      },
      orderBy: [{ salesOrder: { date: "desc" } }],
      take: 1000,
    }),
    db.purchaseOrderItem.findMany({
      where: { description: like, purchaseOrder: { status: { not: "VOID" } } },
      select: {
        description: true,
        unitCost: true,
        purchaseOrder: { select: { id: true, number: true, date: true } },
      },
      orderBy: [{ purchaseOrder: { date: "desc" } }],
      take: 1000,
    }),
  ]);
  const entries: ItemHistoryDetailEntry[] = [
    ...quoteLines
      .filter((l) => normalizeDescription(l.description) === want)
      .map((l) => ({
        description: l.description,
        date: ymd(l.quote.date) ?? "",
        ref: l.quote.number,
        price: String(l.unitPrice),
        docKind: "quote" as const,
        docId: l.quote.id,
      })),
    ...soLines
      .filter((l) => normalizeDescription(l.description) === want)
      .map((l) => ({
        description: l.description,
        date: ymd(l.salesOrder.date) ?? "",
        ref: l.salesOrder.number,
        price: String(l.unitPrice),
        docKind: "sales_order" as const,
        docId: l.salesOrder.id,
      })),
    ...poLines
      .filter((l) => normalizeDescription(l.description) === want)
      .map((l) => ({
        description: l.description,
        date: ymd(l.purchaseOrder.date) ?? "",
        ref: l.purchaseOrder.number,
        cost: String(l.unitCost),
        docKind: "purchase_order" as const,
        docId: l.purchaseOrder.id,
      })),
  ];
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries;
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
