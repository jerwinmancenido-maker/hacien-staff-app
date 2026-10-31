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

/** Supplier-side docs hidden on Home for users without cost access. */
export const COST_ACTIVITY_ENTITY_TYPES = [
  "PurchaseOrder",
  "ReceivingReport",
  "SupplierBill",
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
  /** e.g. "SO-0007 · Sample Corp" — omitted when unknown. */
  detail: string | null;
  href: string | null;
  entityType: string;
  entityId: string | null;
};

export function isCostActivityEntity(entityType: string): boolean {
  return (COST_ACTIVITY_ENTITY_TYPES as readonly string[]).includes(entityType);
}

/** Hide PO / receiving / supplier-bill rows when the viewer cannot see costs. */
export function canShowHomeActivity(entityType: string, withCosts: boolean): boolean {
  if (!withCosts && isCostActivityEntity(entityType)) return false;
  return true;
}

export function filterHomeActivity(
  rows: readonly HomeActivityItem[],
  withCosts: boolean,
  limit = 5,
): HomeActivityItem[] {
  return rows.filter((r) => canShowHomeActivity(r.entityType, withCosts)).slice(0, limit);
}

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

/** Join doc number and counterparty for the activity subtitle. */
export function activityDetail(docNumber: string | null | undefined, party: string | null | undefined): string | null {
  const num = docNumber?.trim() || null;
  const who = party?.trim() || null;
  if (num && who) return `${num} · ${who}`;
  if (num) return num;
  if (who) return who;
  return null;
}

function jsonField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = (value as Record<string, unknown>)[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export async function listRecentHomeActivity(
  limit = 5,
  opts: { withCosts?: boolean } = {},
): Promise<HomeActivityItem[]> {
  const withCosts = opts.withCosts !== false;
  // Over-fetch when cost rows may be filtered out so we still fill `limit`.
  const take = withCosts ? limit : Math.max(limit * 4, 20);
  const entityTypes = withCosts
    ? [...DOC_ENTITY_TYPES]
    : DOC_ENTITY_TYPES.filter((t) => !isCostActivityEntity(t));

  const rows = await db.auditLog.findMany({
    where: {
      entityType: { in: entityTypes },
      action: { in: ["create", "update", "void", "archive", "restore"] },
      entityId: { not: null },
    },
    include: { user: { select: { name: true } } },
    orderBy: { at: "desc" },
    take,
  });

  const quoteIds = rows.filter((r) => r.entityType === "Quote" && r.entityId).map((r) => r.entityId!);
  const soIds = rows.filter((r) => r.entityType === "SalesOrder" && r.entityId).map((r) => r.entityId!);
  const poIds = rows.filter((r) => r.entityType === "PurchaseOrder" && r.entityId).map((r) => r.entityId!);
  const rrIds = rows.filter((r) => r.entityType === "ReceivingReport" && r.entityId).map((r) => r.entityId!);
  const billIds = rows.filter((r) => r.entityType === "SupplierBill" && r.entityId).map((r) => r.entityId!);
  const billingIds = rows.filter((r) => r.entityType === "Billing" && r.entityId).map((r) => r.entityId!);
  const collectionIds = rows.filter((r) => r.entityType === "Collection" && r.entityId).map((r) => r.entityId!);
  const customerIds = rows.filter((r) => r.entityType === "Customer" && r.entityId).map((r) => r.entityId!);
  const supplierIds = rows.filter((r) => r.entityType === "Supplier" && r.entityId).map((r) => r.entityId!);

  const [quotes, sos, pos, rrs, bills, billings, collections, customers, suppliers] = await Promise.all([
    quoteIds.length
      ? db.quote.findMany({
          where: { id: { in: quoteIds } },
          select: { id: true, number: true, customer: { select: { name: true } } },
        })
      : Promise.resolve([]),
    soIds.length
      ? db.salesOrder.findMany({
          where: { id: { in: soIds } },
          select: { id: true, number: true, customer: { select: { name: true } } },
        })
      : Promise.resolve([]),
    poIds.length
      ? db.purchaseOrder.findMany({
          where: { id: { in: poIds } },
          select: { id: true, number: true, supplier: { select: { name: true } } },
        })
      : Promise.resolve([]),
    rrIds.length
      ? db.receivingReport.findMany({
          where: { id: { in: rrIds } },
          select: {
            id: true,
            number: true,
            purchaseOrderId: true,
            purchaseOrder: { select: { number: true, supplier: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    billIds.length
      ? db.supplierBill.findMany({
          where: { id: { in: billIds } },
          select: {
            id: true,
            billNumber: true,
            purchaseOrderId: true,
            purchaseOrder: { select: { number: true, supplier: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    billingIds.length
      ? db.billing.findMany({
          where: { id: { in: billingIds } },
          select: { id: true, number: true, customer: { select: { name: true } } },
        })
      : Promise.resolve([]),
    collectionIds.length
      ? db.collection.findMany({
          where: { id: { in: collectionIds } },
          select: { id: true, number: true, customer: { select: { name: true } } },
        })
      : Promise.resolve([]),
    customerIds.length
      ? db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    supplierIds.length
      ? db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const quoteMap = new Map(quotes.map((q) => [q.id, q]));
  const soMap = new Map(sos.map((s) => [s.id, s]));
  const poMap = new Map(pos.map((p) => [p.id, p]));
  const rrMap = new Map(rrs.map((r) => [r.id, r]));
  const billMap = new Map(bills.map((b) => [b.id, b]));
  const billingMap = new Map(billings.map((b) => [b.id, b]));
  const collectionMap = new Map(collections.map((c) => [c.id, c]));
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

  const items: HomeActivityItem[] = rows.map((r) => {
    const after = r.after;
    let extras: { purchaseOrderId?: string | null } | undefined;
    let docNumber = jsonField(after, "number") ?? jsonField(after, "invoiceNo");
    let party: string | null = jsonField(after, "customerName") ?? jsonField(after, "supplierName");

    if (r.entityType === "Quote" && r.entityId) {
      const q = quoteMap.get(r.entityId);
      docNumber = q?.number ?? docNumber;
      party = q?.customer.name ?? party;
    } else if (r.entityType === "SalesOrder" && r.entityId) {
      const s = soMap.get(r.entityId);
      docNumber = s?.number ?? docNumber;
      party = s?.customer.name ?? party;
    } else if (r.entityType === "PurchaseOrder" && r.entityId) {
      const p = poMap.get(r.entityId);
      docNumber = p?.number ?? docNumber;
      party = p?.supplier.name ?? party;
    } else if (r.entityType === "ReceivingReport" && r.entityId) {
      const rr = rrMap.get(r.entityId);
      extras = { purchaseOrderId: rr?.purchaseOrderId ?? null };
      docNumber = rr?.number ?? rr?.purchaseOrder.number ?? docNumber;
      party = rr?.purchaseOrder.supplier.name ?? party;
    } else if (r.entityType === "SupplierBill" && r.entityId) {
      const b = billMap.get(r.entityId);
      extras = { purchaseOrderId: b?.purchaseOrderId ?? null };
      docNumber = b?.billNumber ?? docNumber;
      party = b?.purchaseOrder?.supplier.name ?? party;
    } else if (r.entityType === "Billing" && r.entityId) {
      const b = billingMap.get(r.entityId);
      docNumber = b?.number ?? docNumber;
      party = b?.customer.name ?? party;
    } else if (r.entityType === "Collection" && r.entityId) {
      const c = collectionMap.get(r.entityId);
      docNumber = c?.number ?? docNumber;
      party = c?.customer.name ?? party;
    } else if (r.entityType === "Customer" && r.entityId) {
      party = customerMap.get(r.entityId)?.name ?? party;
    } else if (r.entityType === "Supplier" && r.entityId) {
      party = supplierMap.get(r.entityId)?.name ?? party;
    }

    return {
      id: r.id,
      at: r.at,
      atLabel: formatDateTime(r.at),
      summary: activitySummary(r.action, r.entityType, r.user?.name ?? null),
      detail: activityDetail(docNumber, party),
      href: documentHref(r.entityType, r.entityId, extras),
      entityType: r.entityType,
      entityId: r.entityId,
    };
  });

  return filterHomeActivity(items, withCosts, limit);
}
