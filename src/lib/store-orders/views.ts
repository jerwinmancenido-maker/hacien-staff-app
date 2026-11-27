// Store Orders inbox read side (store intake Slice 1): list + detail views,
// the PAID count the Sidebar badge and the bell section share, and the
// derived display status. DONE is derived, never stored: a converted order
// reads DONE when its linked Sales Order is CLOSED (fully billed + paid +
// delivered — a store SO is billed and paid from conversion, so delivery
// completion closes it).

import type { StoreOrderStatus } from "@prisma/client";
import { db } from "../db";

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
