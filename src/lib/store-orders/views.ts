// Store Orders inbox read side (store intake Slice 1): list + detail views,
// the PAID count the Sidebar badge and the bell section share, and the
// derived display status. DONE is derived, never stored: a converted order
// reads DONE when its linked Sales Order is CLOSED (fully billed + paid +
// delivered — a store SO is billed and paid from conversion, so delivery
// completion closes it).

import type { StoreOrderStatus } from "@prisma/client";
import { db } from "../db";
import { money } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { getSettingsSnapshot } from "../settings";
import { listSupplierPriceComparison } from "../items/history";

export const STORE_ORDER_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  PAID: "Paid — to convert",
  CONFIRMED: "Converted",
  PROVISIONING: "Provisioning",
  REFUNDED: "Refunded",
  CHARGEBACK: "Chargeback",
};

export type StoreOrderDisplayStatus = StoreOrderStatus | "DONE";

export function storeOrderDisplayStatus(order: {
  status: StoreOrderStatus;
  salesOrder: { status: string } | null;
}): StoreOrderDisplayStatus {
  if (order.status === "CONFIRMED" && order.salesOrder?.status === "CLOSED") return "DONE";
  return order.status;
}

export function storeOrderDisplayLabel(status: StoreOrderDisplayStatus): string {
  return status === "DONE" ? "Done" : STORE_ORDER_STATUS_LABELS[status];
}

export const STORE_ORDER_PAGE_SIZE = 25;

export async function listStoreOrders(input: { status?: StoreOrderStatus | null; page?: number }) {
  const page = Math.max(1, input.page ?? 1);
  const where = input.status ? { status: input.status } : {};
  const [total, rows] = await Promise.all([
    db.storeOrder.count({ where }),
    db.storeOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * STORE_ORDER_PAGE_SIZE,
      take: STORE_ORDER_PAGE_SIZE,
      include: {
        lines: { select: { matchFlag: true } },
        matchedCustomer: { select: { name: true } },
        salesOrder: { select: { status: true } },
      },
    }),
  ]);
  return {
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / STORE_ORDER_PAGE_SIZE)),
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      displayStatus: storeOrderDisplayStatus(r),
      buyerName: r.buyerName,
      gatewayName: r.gatewayName,
      amountPaid: r.amountPaid.toFixed(2),
      paidAt: r.paidAt,
      createdAt: r.createdAt,
      lineCount: r.lines.length,
      unmappedCount: r.lines.filter((l) => l.matchFlag !== "MAPPED").length,
      matchedCustomerName: r.matchedCustomer?.name ?? null,
    })),
  };
}

export async function getStoreOrderDetail(id: string) {
  const order = await db.storeOrder.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" }, include: { item: { select: { id: true, name: true, sku: true } } } },
      matchedCustomer: { select: { id: true, name: true } },
      matchedContact: { select: { id: true, name: true, email: true, phone: true } },
      salesOrder: { select: { id: true, number: true, status: true } },
    },
  });
  if (!order) return null;
  return { ...order, displayStatus: storeOrderDisplayStatus(order) };
}

/** PAID orders waiting for conversion — the Sidebar badge + bell count. */
export async function countPaidStoreOrders(): Promise<number> {
  return db.storeOrder.count({ where: { status: "PAID" } });
}

export type StoreOrderConversionPrep = {
  orderId: string;
  number: string;
  amountPaid: string;
  deliveryFee: string;
  gatewayFee: string;
  gatewayName: string;
  gatewayPaymentRef: string;
  matchedCustomer: { id: string; name: string } | null;
  siRange: { from: number; to: number };
  /** Lowest unclaimed in-band SI serial — a pre-fill only, never a claim. */
  nextSi: number | null;
  lines: {
    id: string;
    title: string;
    qty: string;
    unit: string;
    unitPrice: string;
    lineTotal: string;
    matchFlag: "MAPPED" | "NO_MATCH" | "AMBIGUOUS";
    mappedItemName: string | null;
    needsPick: boolean;
    costPreview: { supplierName: string; unitCost: string } | null;
  }[];
  /** Product lines with no last-PO cost history (they convert at cost 0). */
  linesWithoutCost: string[];
  /** Estimated margin % from last-PO costs; null when any product line has no cost history. */
  marginPreviewPct: string | null;
};

/**
 * Everything the conversion dialog shows before staff commit (Slice 2):
 * the match proposal, per-line resolution state + last-PO cost previews,
 * the booklet band + lowest unclaimed SI, and the §10.11 informational
 * margin figure (recorded at conversion, never blocking).
 */
export async function getStoreOrderConversionPrep(id: string): Promise<StoreOrderConversionPrep | null> {
  const order = await getStoreOrderDetail(id);
  if (!order) return null;

  const snap = await getSettingsSnapshot();
  const range = snap.settings.invoiceBooklet.salesInvoice ?? snap.settings.invoiceBooklet;
  const [usedBillings, spoiled, claims] = await Promise.all([
    db.billing.findMany({
      where: { invoiceNo: { gte: range.seriesFrom, lte: range.seriesTo } },
      select: { invoiceNo: true },
    }),
    db.spoiledBookletNumber.findMany({ where: { type: "SI" }, select: { number: true } }),
    db.bookletSerialClaim.findMany({ where: { type: "SI" }, select: { number: true } }),
  ]);
  const used = new Set<number>([
    ...usedBillings.map((b) => b.invoiceNo),
    ...spoiled.map((s) => s.number),
    ...claims.map((c) => c.number),
  ]);
  let nextSi: number | null = null;
  for (let n = range.seriesFrom; n <= range.seriesTo; n++) {
    if (!used.has(n)) {
      nextSi = n;
      break;
    }
  }

  const lines: StoreOrderConversionPrep["lines"] = [];
  const linesWithoutCost: string[] = [];
  let pricedTotal = 0n;
  let costTotal = 0n;
  let allPriced = true;
  for (const line of order.lines) {
    let costPreview: { supplierName: string; unitCost: string } | null = null;
    if (line.item) {
      const rows = await listSupplierPriceComparison(line.item.name);
      if (rows.length) {
        const newest = rows.reduce((a, b) => (b.lastCostDate > a.lastCostDate ? b : a));
        costPreview = { supplierName: newest.supplierName, unitCost: newest.lastCost };
      }
    }
    const needsPick = !line.item;
    if (line.item && !costPreview) linesWithoutCost.push(line.title);
    if (costPreview) {
      pricedTotal += toScaled(money(line.lineTotal), 2);
      // Scale-4 accumulation: unitCost (scale 2) × qty (scale 2).
      costTotal += toScaled(costPreview.unitCost, 2) * toScaled(money(line.qty), 2);
    } else {
      allPriced = false;
    }
    lines.push({
      id: line.id,
      title: line.title,
      qty: money(line.qty),
      unit: line.unit,
      unitPrice: money(line.unitPrice),
      lineTotal: money(line.lineTotal),
      matchFlag: line.matchFlag,
      mappedItemName: line.item?.name ?? null,
      needsPick,
      costPreview,
    });
  }
  // pricedTotal is scale 2, costTotal is scale 4 — compare at scale 4.
  const marginPreviewPct =
    allPriced && pricedTotal > 0n
      ? fromScaled(((pricedTotal * 100n - costTotal) * 10000n) / (pricedTotal * 100n), 2)
      : null;

  return {
    orderId: order.id,
    number: order.number,
    amountPaid: money(order.amountPaid),
    deliveryFee: money(order.deliveryFee),
    gatewayFee: money(order.gatewayFee),
    gatewayName: order.gatewayName,
    gatewayPaymentRef: order.gatewayPaymentRef,
    matchedCustomer: order.matchedCustomer ? { id: order.matchedCustomer.id, name: order.matchedCustomer.name } : null,
    siRange: { from: range.seriesFrom, to: range.seriesTo },
    nextSi,
    lines,
    linesWithoutCost,
    marginPreviewPct,
  };
}

/** Customer + catalogue pick lists for the conversion dialog. */
export async function listStoreOrderConversionOptions() {
  const [customers, items] = await Promise.all([
    db.customer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    db.item.findMany({
      where: { active: true },
      select: { id: true, name: true, sku: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
  ]);
  return { customers, items };
}

/** Bell section data: the oldest PAID orders first (they wait longest). */
export async function storeOrderBellData(): Promise<{ count: number; items: { label: string; href: string }[] }> {
  const [count, oldest] = await Promise.all([
    countPaidStoreOrders(),
    db.storeOrder.findMany({
      where: { status: "PAID" },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true, number: true, buyerName: true },
    }),
  ]);
  return {
    count,
    items: oldest.map((o) => ({ label: `${o.number} · ${o.buyerName}`, href: `/store-orders/${o.id}` })),
  };
}
