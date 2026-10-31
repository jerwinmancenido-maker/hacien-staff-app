// Recent document activity for the Home dashboard (read-only audit rows).

import { db } from "../db";
import { formatDateTime } from "../format";

const DOC_ENTITY_TYPES = [
  "Quote",
  "SalesOrder",
  "PurchaseOrder",
  "ReceivingReport",
  "SupplierBill",
  "Billing",
  "Collection",
  "Customer",
  "Supplier",
] as const;

const ACTION_LABELS: Record<string, string> = {
  create: "created",
  update: "changed",
  archive: "archived",
  restore: "restored",
  void: "voided",
  settings_change: "changed",
  email_draft: "drafted email for",
  download: "downloaded",
};

const ENTITY_LABELS: Record<string, string> = {
  Quote: "quote",
  SalesOrder: "sales order",
  PurchaseOrder: "purchase order",
  ReceivingReport: "receiving report",
  SupplierBill: "supplier bill",
  Billing: "billing",
  Collection: "collection",
  Customer: "customer",
  Supplier: "supplier",
};

export type HomeActivityItem = {
  id: string;
  atLabel: string;
  at: Date;
  summary: string;
  href: string | null;
  entityType: string;
  entityId: string | null;
};

export function documentHref(
  entityType: string,
  entityId: string | null,
  extras?: { purchaseOrderId?: string | null },
): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case "Quote":
      return `/quotes/${entityId}`;
    case "SalesOrder":
      return `/sales-orders/${entityId}`;
    case "PurchaseOrder":
      return `/purchase-orders/${entityId}`;
    case "ReceivingReport":
      return extras?.purchaseOrderId ? `/receiving/${extras.purchaseOrderId}` : null;
    case "SupplierBill":
      return extras?.purchaseOrderId ? `/purchase-orders/${extras.purchaseOrderId}?tab=bills` : null;
    case "Billing":
      return `/billing/billings/${entityId}`;
    case "Collection":
      return `/billing/collections/${entityId}`;
    case "Customer":
      return `/customers/${entityId}`;
    case "Supplier":
      return `/suppliers/${entityId}`;
    default:
      return null;
  }
}

export function activitySummary(action: string, entityType: string, who: string | null): string {
  const verb = ACTION_LABELS[action] ?? action;
  const what = ENTITY_LABELS[entityType] ?? entityType.toLowerCase();
  const actor = who?.trim() || "Someone";
  return `${actor} ${verb} a ${what}`;
}

export async function listRecentHomeActivity(limit = 5): Promise<HomeActivityItem[]> {
  const rows = await db.auditLog.findMany({
    where: {
      entityType: { in: [...DOC_ENTITY_TYPES] },
      action: { in: ["create", "update", "void", "archive", "restore"] },
      entityId: { not: null },
    },
    include: { user: { select: { name: true } } },
    orderBy: { at: "desc" },
    take: limit,
  });

  const rrIds = rows.filter((r) => r.entityType === "ReceivingReport" && r.entityId).map((r) => r.entityId!);
  const billIds = rows.filter((r) => r.entityType === "SupplierBill" && r.entityId).map((r) => r.entityId!);
  const [rrs, bills] = await Promise.all([
    rrIds.length
      ? db.receivingReport.findMany({ where: { id: { in: rrIds } }, select: { id: true, purchaseOrderId: true } })
      : Promise.resolve([]),
    billIds.length
      ? db.supplierBill.findMany({ where: { id: { in: billIds } }, select: { id: true, purchaseOrderId: true } })
      : Promise.resolve([]),
  ]);
  const rrPo = new Map(rrs.map((r) => [r.id, r.purchaseOrderId]));
  const billPo = new Map(bills.map((b) => [b.id, b.purchaseOrderId]));

  return rows.map((r) => {
    const extras =
      r.entityType === "ReceivingReport"
        ? { purchaseOrderId: r.entityId ? rrPo.get(r.entityId) ?? null : null }
        : r.entityType === "SupplierBill"
          ? { purchaseOrderId: r.entityId ? billPo.get(r.entityId) ?? null : null }
          : undefined;
    return {
      id: r.id,
      at: r.at,
      atLabel: formatDateTime(r.at),
      summary: activitySummary(r.action, r.entityType, r.user?.name ?? null),
      href: documentHref(r.entityType, r.entityId, extras),
      entityType: r.entityType,
      entityId: r.entityId,
    };
  });
}
