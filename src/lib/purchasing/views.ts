// What the server sends to pages for supplier POs and receiving.
//
// Costs rule: PO pages, the PO print, bills and the match view are cost data
// and are built only for users with "Can see costs" (others get
// ForbiddenError; pages send them to /no-access). The receiving views are for
// everyone with "view" and are built WITHOUT unit costs, totals or amounts —
// the keys are never set — and also pass through stripCosts() as a backstop.
// tests/db/purchasing.db.test.ts inspects these payloads.

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { canSeeCosts, ForbiddenError, stripCosts, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { money, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { threeWayMatch } from "./match";
import { qtyMismatch } from "./plan";
import { remainingQty } from "./receipt";
import { approverError, canPo, PO_STATUSES, soLineProgress, type PoStatus, type ProgressState } from "./status";
import { planPurchaseOrders } from "./plan";

type Viewer = PermissionUser & { id: string; isAdmin: boolean };

function assertCosts(viewer: PermissionUser) {
  if (!canSeeCosts(viewer)) throw new ForbiddenError();
}

const userName = { select: { id: true, name: true } } as const;
const attachmentSelect = { where: { archivedAt: null }, select: { id: true, fileName: true, sizeBytes: true, mimeType: true }, orderBy: { createdAt: "asc" } } as const;

// ---------------------------------------------------------------------------
// PO list / detail (cost users only)
// ---------------------------------------------------------------------------

export type PoListFilter = { q?: string; status?: PoStatus; open?: boolean };

export async function listPurchaseOrdersView(filter: PoListFilter, viewer: PermissionUser) {
  assertCosts(viewer);
  const q = filter.q?.trim();
  const rows = await db.purchaseOrder.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.open ? { status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } } : {}),
      ...(q ? { OR: [{ number: { contains: q } }, { supplier: { name: { contains: q } } }, { salesOrder: { number: { contains: q } } }] } : {}),
    },
    include: { supplier: { select: { name: true } }, salesOrder: { select: { id: true, number: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    revision: r.revision,
    status: r.status,
    supplierName: r.supplier.name,
    salesOrder: r.salesOrder,
    date: ymd(r.date)!,
    expectedDate: ymd(r.expectedDate),
    subtotal: money(r.subtotal),
  }));
}

export async function getPurchaseOrderView(id: string, viewer: Viewer) {
  assertCosts(viewer);
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, tin: true, active: true } },
      supplierContact: { select: { id: true, name: true, email: true, phone: true } },
      salesOrder: { select: { id: true, number: true, customer: { select: { id: true, name: true } } } },
      items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" }, include: { salesOrderItem: { select: { id: true, qty: true } } } },
      approvedBy: userName,
      createdBy: userName,
      updatedBy: userName,
      receivingReports: {
        orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }],
        include: { receivedBy: userName, items: true, attachments: attachmentSelect },
      },
      bills: {
        orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
        include: {
          items: true,
          attachments: attachmentSelect,
          createdBy: userName,
          allocations: {
            where: { supplierPayment: { status: "POSTED" } },
            include: { supplierPayment: { select: { id: true, number: true } } },
          },
        },
      },
    },
  });
  if (!po) return null;

  // Other live PO lines for the same SO lines, for the "PO qty ≠ SO qty" warning.
  const soLineIds = po.items.map((i) => i.salesOrderItemId).filter((v): v is string => !!v);
  const siblings = soLineIds.length
    ? await db.purchaseOrderItem.findMany({
        where: { salesOrderItemId: { in: soLineIds }, removedAt: null, purchaseOrder: { status: { not: "VOID" } } },
        select: { salesOrderItemId: true, qty: true },
      })
    : [];

  const items = po.items.map((i) => {
    const soQty = i.salesOrderItem ? money(i.salesOrderItem.qty) : null;
    const warning =
      soQty && po.status !== "VOID"
        ? qtyMismatch(
            soQty,
            siblings.filter((s) => s.salesOrderItemId === i.salesOrderItemId).map((s) => money(s.qty)),
          )
        : null;
    return {
      id: i.id,
      description: i.description,
      kind: i.kind,
      qty: money(i.qty),
      unit: i.unit,
      unitCost: money(i.unitCost),
      total: money(i.total),
      receivedQty: money(i.receivedQty),
      remainingQty: remainingQty({ qty: money(i.qty), receivedQty: money(i.receivedQty) }),
      salesOrderItemId: i.salesOrderItemId,
      soQty,
      qtyWarning: warning,
    };
  });

  const liveBills = po.bills.filter((b) => b.status !== "VOID");
  const match = threeWayMatch(
    items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, qty: i.qty, unitCost: i.unitCost, receivedQty: i.receivedQty })),
    liveBills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      amount: money(b.amount),
      items: b.items.map((x) => ({ purchaseOrderItemId: x.purchaseOrderItemId, qty: money(x.qty), unitPrice: money(x.unitPrice) })),
    })),
  );
  const lineDesc = new Map(items.map((i) => [i.id, i.description]));

  return {
    id: po.id,
    number: po.number,
    revision: po.revision,
    status: po.status,
    date: ymd(po.date)!,
    expectedDate: ymd(po.expectedDate),
    terms: po.terms,
    deliveryAddressText: po.deliveryAddressText,
    supplierAddressText: po.supplierAddressText,
    notes: po.notes,
    subtotal: money(po.subtotal),
    supplier: po.supplier,
    supplierContact: po.supplierContact,
    salesOrder: po.salesOrder,
    approvedBy: po.approvedBy?.name ?? null,
    approvedAt: po.approvedAt,
    sentAt: po.sentAt,
    closedAt: po.closedAt,
    closeReason: po.closeReason,
    voidReason: po.voidReason,
    createdBy: po.createdBy.name,
    createdById: po.createdById,
    updatedBy: po.updatedBy.name,
    items,
    receivingReports: po.receivingReports.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      receivedDate: ymd(r.receivedDate)!,
      receivedBy: r.receivedBy.name,
      deliveryRef: r.deliveryRef,
      notes: r.notes,
      voidReason: r.voidReason,
      items: r.items.map((x) => ({ description: lineDesc.get(x.purchaseOrderItemId) ?? "(removed line)", qty: money(x.qtyReceived) })),
      attachments: r.attachments,
    })),
    bills: po.bills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      billDate: ymd(b.billDate)!,
      dueDate: ymd(b.dueDate)!,
      amount: money(b.amount),
      status: b.status,
      notes: b.notes,
      voidReason: b.voidReason,
      createdBy: b.createdBy.name,
      items: b.items.map((x) => ({ description: lineDesc.get(x.purchaseOrderItemId) ?? "(removed line)", qty: money(x.qty), unitPrice: money(x.unitPrice), total: money(x.total) })),
      attachments: b.attachments,
      payments: b.allocations.map((a) => ({
        id: a.supplierPayment.id,
        number: a.supplierPayment.number,
        cashApplied: money(a.cashApplied),
        withholdingApplied: money(a.withholdingApplied),
      })),
    })),
    match,
    postedReceipts: po.receivingReports.filter((r) => r.status === "POSTED").length,
    approval: {
      canApprove: canPo(po.status, "approve") && approverError(viewer, po.createdById) === null,
      blockedReason: canPo(po.status, "approve") ? approverError(viewer, po.createdById) : null,
    },
  };
}
export type PurchaseOrderView = NonNullable<Awaited<ReturnType<typeof getPurchaseOrderView>>>;

/** Raw values for the PO edit form (cost users only). */
export async function getPurchaseOrderEditData(id: string, viewer: PermissionUser) {
  assertCosts(viewer);
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } } });
  if (!po) return null;
  return {
    id: po.id,
    number: po.number,
    status: po.status,
    supplierId: po.supplierId,
    supplierContactId: po.supplierContactId ?? "",
    date: ymd(po.date)!,
    expectedDate: ymd(po.expectedDate) ?? "",
    terms: po.terms ?? "",
    deliveryAddressText: po.deliveryAddressText ?? "",
    supplierAddressText: po.supplierAddressText ?? "",
    notes: po.notes ?? "",
    items: po.items.map((i) => ({ id: i.id, description: i.description, kind: i.kind, qty: money(i.qty), unit: i.unit, unitCost: money(i.unitCost), linked: !!i.salesOrderItemId })),
  };
}

// ---------------------------------------------------------------------------
// Create POs from a sales order: the preview (cost users only)
// ---------------------------------------------------------------------------

export async function getCreatePosPreview(salesOrderId: string, viewer: PermissionUser) {
  assertCosts(viewer);
  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      customer: { select: { name: true } },
      quote: { select: { number: true, status: true } },
      items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" }, include: { supplier: { select: { id: true, name: true } } } },
    },
  });
  if (!so) return null;
  const live = await db.purchaseOrderItem.findMany({
    where: { activeSalesOrderItemId: { in: so.items.map((i) => i.id) } },
    select: { activeSalesOrderItemId: true, purchaseOrder: { select: { id: true, number: true } } },
  });
  const onPo = new Map(live.map((l) => [l.activeSalesOrderItemId!, l.purchaseOrder]));
  const lines = so.items.map((i) => ({
    id: i.id,
    sortOrder: i.sortOrder,
    description: i.description,
    kind: i.kind,
    qty: money(i.qty),
    unit: i.unit,
    supplierId: i.supplierId,
    supplierName: i.supplier?.name ?? null,
    supplierUnitCost: money(i.supplierUnitCost),
    purchaseOrder: onPo.get(i.id) ?? null,
  }));
  const plan = planPurchaseOrders(lines, new Set(onPo.keys()));
  const suppliers = await db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return {
    id: so.id,
    number: so.number,
    status: so.status,
    quoteStatus: so.quote.status,
    customerName: so.customer.name,
    deliveryAddress: so.deliveryAddress,
    lines,
    plannedCount: plan.pos.length,
    needsSupplierCount: plan.needsSupplier.length,
    suppliers,
  };
}

// ---------------------------------------------------------------------------
// Sales order: purchasing progress (everyone who can view the SO)
// ---------------------------------------------------------------------------

export type SoPurchasingLine = {
  id: string;
  state: ProgressState;
  ordered: string;
  received: string;
  /** PO numbers; `id` only for cost users (PO pages are cost-gated). */
  purchaseOrders: { id?: string; number: string; status: PoStatus }[];
};

export async function getSoPurchasing(salesOrderId: string, viewer: PermissionUser) {
  const withCosts = canSeeCosts(viewer);
  const items = await db.salesOrderItem.findMany({
    where: { salesOrderId, removedAt: null },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      qty: true,
      purchaseOrderItems: {
        where: { removedAt: null, purchaseOrder: { status: { not: "VOID" } } },
        select: { qty: true, receivedQty: true, purchaseOrder: { select: { id: true, number: true, status: true } } },
      },
    },
  });
  const lines: SoPurchasingLine[] = items.map((i) => {
    const p = soLineProgress(
      money(i.qty),
      i.purchaseOrderItems.map((x) => ({ qty: money(x.qty), receivedQty: money(x.receivedQty) })),
    );
    const seen = new Set<string>();
    const purchaseOrders = i.purchaseOrderItems
      .map((x) => x.purchaseOrder)
      .filter((po) => (seen.has(po.id) ? false : (seen.add(po.id), true)))
      .map((po) => (withCosts ? { id: po.id, number: po.number, status: po.status } : { number: po.number, status: po.status }));
    return { id: i.id, ...p, purchaseOrders };
  });
  return {
    lines,
    total: lines.length,
    received: lines.filter((l) => l.state === "RECEIVED").length,
    ordered: lines.filter((l) => l.state !== "NOT_ORDERED").length,
    canSeeCosts: withCosts,
  };
}

// ---------------------------------------------------------------------------
// Receiving (no prices — for staff and viewers too)
// ---------------------------------------------------------------------------

const RECEIVABLE: PoStatus[] = ["SENT", "PARTIALLY_RECEIVED"];

export type ReceivingListRow = {
  id: string;
  number: string;
  status: PoStatus;
  supplier: { name: string };
  salesOrderNumber: string | null;
  date: string;
  expectedDate: string | null;
  lineCount: number;
  orderedQty: string;
  receivedQty: string;
};

/** POs out for delivery (Sent / Partially received), or all received history with `history`. */
export async function listReceivingView(filter: { q?: string; history?: boolean }, viewer: PermissionUser): Promise<ReceivingListRow[]> {
  const q = filter.q?.trim();
  const rows = await db.purchaseOrder.findMany({
    where: {
      status: { in: filter.history ? ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] : RECEIVABLE },
      ...(q ? { OR: [{ number: { contains: q } }, { supplier: { name: { contains: q } } }] } : {}),
    },
    select: {
      id: true,
      number: true,
      status: true,
      date: true,
      expectedDate: true,
      supplier: { select: { name: true } },
      salesOrder: { select: { number: true } },
      items: { where: { removedAt: null }, select: { qty: true, receivedQty: true } },
    },
    orderBy: [{ expectedDate: "asc" }, { date: "asc" }],
    take: 500,
  });
  const sum = (xs: { toFixed(n: number): string }[]) => fromScaled(xs.reduce((a, x) => a + toScaled(money(x), 2), 0n), 2);
  return stripCosts(
    rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      supplier: { name: r.supplier.name },
      salesOrderNumber: r.salesOrder?.number ?? null,
      date: ymd(r.date)!,
      expectedDate: ymd(r.expectedDate),
      lineCount: r.items.length,
      orderedQty: sum(r.items.map((i) => i.qty)),
      receivedQty: sum(r.items.map((i) => i.receivedQty)),
    })),
    viewer,
  );
}

export async function getReceivingView(purchaseOrderId: string, viewer: PermissionUser) {
  const po = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      number: true,
      status: true,
      date: true,
      expectedDate: true,
      deliveryAddressText: true,
      supplier: { select: { name: true } },
      salesOrder: { select: { number: true } },
      items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, description: true, kind: true, unit: true, qty: true, receivedQty: true } },
      receivingReports: {
        orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          number: true,
          status: true,
          receivedDate: true,
          deliveryRef: true,
          notes: true,
          voidReason: true,
          receivedBy: { select: { name: true } },
          items: { select: { purchaseOrderItemId: true, qtyReceived: true } },
          attachments: attachmentSelect,
        },
      },
    },
  });
  if (!po || po.status === "DRAFT" || po.status === "APPROVED") return null;
  const desc = new Map(po.items.map((i) => [i.id, i.description]));
  const view = {
    id: po.id,
    number: po.number,
    status: po.status,
    supplier: { name: po.supplier.name },
    salesOrderNumber: po.salesOrder?.number ?? null,
    date: ymd(po.date)!,
    expectedDate: ymd(po.expectedDate),
    deliveryAddressText: po.deliveryAddressText,
    canReceive: RECEIVABLE.includes(po.status),
    lines: po.items.map((i) => ({
      id: i.id,
      description: i.description,
      kind: i.kind,
      unit: i.unit,
      orderedQty: money(i.qty),
      receivedQty: money(i.receivedQty),
      remainingQty: remainingQty({ qty: money(i.qty), receivedQty: money(i.receivedQty) }),
    })),
    receivingReports: po.receivingReports.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      receivedDate: ymd(r.receivedDate)!,
      receivedBy: r.receivedBy.name,
      deliveryRef: r.deliveryRef,
      notes: r.notes,
      voidReason: r.voidReason,
      items: r.items.map((x) => ({ description: desc.get(x.purchaseOrderItemId) ?? "(removed line)", qty: money(x.qtyReceived) })),
      attachments: r.attachments,
    })),
  };
  return stripCosts(view, viewer);
}
export type ReceivingView = NonNullable<Awaited<ReturnType<typeof getReceivingView>>>;

// ---------------------------------------------------------------------------
// Print (A4, cost users only; no customer prices or margins)
// ---------------------------------------------------------------------------

export type PoPrintDoc = {
  number: string;
  revision: number;
  status: string;
  date: string;
  expectedDate: string | null;
  company: { name: string; tin: string; address: string };
  supplier: { name: string; tin: string | null; address: string | null };
  contact: { name: string; email: string | null; phone: string | null } | null;
  deliveryAddress: string | null;
  salesOrderNumber: string | null;
  items: { description: string; qty: string; unit: string; unitCost: string; total: string }[];
  subtotal: string;
  terms: string | null;
  notes: string | null;
};

export async function getPurchaseOrderPrint(id: string, viewer: PermissionUser): Promise<PoPrintDoc | null> {
  assertCosts(viewer);
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      supplierContact: { select: { name: true, email: true, phone: true } },
      salesOrder: { select: { number: true } },
      items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!po) return null;
  // Our letterhead (name, TIN, address) always comes from the current Company
  // settings, so a TIN or address added after the PO was created still prints.
  const { settings } = await getSettingsSnapshot();
  return {
    number: po.number,
    revision: po.revision,
    status: po.status,
    date: ymd(po.date)!,
    expectedDate: ymd(po.expectedDate),
    company: settings.company,
    supplier: { name: po.supplier.name, tin: po.supplier.tin, address: po.supplierAddressText },
    contact: po.supplierContact,
    deliveryAddress: po.deliveryAddressText,
    salesOrderNumber: po.salesOrder?.number ?? null,
    items: po.items.map((i) => ({ description: i.description, qty: money(i.qty), unit: i.unit, unitCost: money(i.unitCost), total: money(i.total) })),
    subtotal: money(po.subtotal),
    terms: po.terms,
    notes: po.notes,
  };
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

/** Open POs (Approved/Sent/Partially received) and POs awaiting receipt (Sent/Partially received). */
export async function purchasingStats(where: Prisma.PurchaseOrderWhereInput = {}) {
  const [open, awaiting] = await Promise.all([
    db.purchaseOrder.aggregate({ where: { ...where, status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } }, _count: true, _sum: { subtotal: true } }),
    db.purchaseOrder.count({ where: { ...where, status: { in: RECEIVABLE } } }),
  ]);
  return { openPos: open._count, openPosTotal: money(open._sum.subtotal ?? "0"), awaitingReceipt: awaiting };
}

export { PO_STATUSES };
