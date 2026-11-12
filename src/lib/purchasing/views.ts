// What the server sends to pages for supplier POs and receiving.
//
// Costs rule (Audit F): the PO list and detail pages are for every viewer,
// but money is cost-only — for users without "Can see costs" the payload
// carries no unit costs, totals, bill amounts or match (the keys are nulled
// or emptied, never set). The PO print, bills and the match view stay cost
// data (ForbiddenError; pages send them to /no-access). The receiving views
// are for everyone with "view" and are built WITHOUT unit costs, totals or
// amounts — the keys are never set — and also pass through stripCosts() as
// a backstop. tests/db/purchasing.db.test.ts inspects these payloads.

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { canApprove, canSeeCosts, ForbiddenError, stripCosts, type PermissionUser } from "../permissions";
import { getSettingsSnapshot, getSettingsVersion } from "../settings";
import { money, ymd } from "../documents/common";
import { manilaToday } from "../format";
import { fromScaled, toScaled } from "../quotes/calc";
import { threeWayMatch } from "./match";
import { remainingQty } from "./receipt";
import {
  approverError,
  canPo,
  poNeedsApproval,
  PO_STATUSES,
  soLineProgress,
  type PoStatus,
  type ProgressState,
} from "./status";
import { loadOrderedQty } from "./ordered";
import { planPurchaseOrders, qtyLeft, qtyMismatch } from "./plan";
import { receivingCoverageNote } from "../billing/coverage";
import { buildSoPickerRows, remainingQtyForExistingPoLine, type SoPickerRow } from "./picker";
import {
  billExceedsPo,
  buildCostMarginSummary,
  lineHasUnorderedQty,
  lineNeedsMorePo,
  sumMoney,
  valueReceived,
  type CostMarginSummary,
} from "./cost-margin";
import { warrantySoonWindow } from "./warranty-soon";

type Viewer = PermissionUser & { id: string; isAdmin: boolean };

function assertCosts(viewer: PermissionUser) {
  if (!canSeeCosts(viewer)) throw new ForbiddenError();
}

const userName = { select: { id: true, name: true } } as const;
const attachmentSelect = { where: { archivedAt: null }, select: { id: true, fileName: true, sizeBytes: true, mimeType: true }, orderBy: { createdAt: "asc" } } as const;

// ---------------------------------------------------------------------------
// PO list / detail (cost users only)
// ---------------------------------------------------------------------------

export type PoListFilter = {
  q?: string;
  status?: PoStatus;
  open?: boolean;
  /** Non-void supplier bill totals higher than the PO subtotal. */
  billedOver?: boolean;
};

export async function listPurchaseOrdersView(filter: PoListFilter, viewer: PermissionUser) {
  // Audit F: every viewer can list POs; money stays cost-only. The
  // "billed over PO" filter compares bill totals to PO totals, so it only
  // applies for cost viewers.
  const withCosts = canSeeCosts(viewer);
  const q = filter.q?.trim();
  const billedOver = filter.billedOver === true && withCosts;
  const rows = await db.purchaseOrder.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.open ? { status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } } : {}),
      ...(billedOver ? { status: { not: "VOID" }, bills: { some: { status: { not: "VOID" } } } } : {}),
      ...(q ? { OR: [{ number: { contains: q } }, { supplier: { name: { contains: q } } }, { salesOrder: { number: { contains: q } } }] } : {}),
    },
    include: {
      supplier: { select: { name: true } },
      salesOrder: { select: { id: true, number: true } },
      ...(billedOver ? { bills: { where: { status: { not: "VOID" } }, select: { amount: true } } } : {}),
    },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 500,
  });

  const filtered = billedOver
    ? rows.filter((r) => {
        const bills = (r as { bills?: { amount: { toFixed(n: number): string } }[] }).bills ?? [];
        const billed = sumMoney(bills.map((b) => money(b.amount)));
        return billExceedsPo(money(r.subtotal), billed);
      })
    : rows;

  return filtered.map((r) => ({
    id: r.id,
    number: r.number,
    revision: r.revision,
    status: r.status,
    supplierName: r.supplier.name,
    salesOrder: r.salesOrder,
    date: ymd(r.date)!,
    expectedDate: ymd(r.expectedDate),
    // Audit F: null for non-cost viewers — the list page hides the column.
    subtotal: withCosts ? money(r.subtotal) : null,
  }));
}

export async function getPurchaseOrderView(id: string, viewer: Viewer) {
  // Audit F: every viewer can open a PO; money is stripped below for
  // non-cost viewers.
  const withCosts = canSeeCosts(viewer);
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
  const subtotal = money(po.subtotal);
  // Pin the PO's settings version so raising the live limit does not unlock old drafts.
  // Missing/unresolvable pin → needs approval (fail closed; do not use latest Settings).
  const snap = await getSettingsVersion(po.settingsVersionId);
  const needsApproval = !snap || poNeedsApproval(subtotal, snap.settings.approval.poTotalAbove);
  const selfErr = canPo(po.status, "approve") ? approverError(viewer, po.createdById) : null;
  const canApproveThis = canApprove(viewer) && canPo(po.status, "approve") && selfErr === null;
  const blockedReason = canPo(po.status, "approve") ? selfErr : null;

  const view = {
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
    subtotal,
    // Audit F: the page hides money UI when this is false.
    canSeeCosts: withCosts,
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
      items: r.items.map((x) => ({ description: lineDesc.get(x.purchaseOrderItemId) ?? "(removed line)", qty: money(x.qtyReceived), warrantyEndDate: ymd(x.warrantyEndDate), serialNumbers: x.serialNumbers })),
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
      canApprove: canApproveThis,
      blockedReason,
      needsApproval,
      canMarkSentFromDraft: po.status === "DRAFT" && !needsApproval,
    },
  };
  if (withCosts) return view;
  // Audit F: strip every money field for non-cost viewers. Bills and the
  // match are money, so they come back empty — the page hides those tabs.
  return {
    ...view,
    subtotal: null,
    items: view.items.map((i) => ({ ...i, unitCost: null, total: null })),
    bills: [],
    match: null,
  };
}
export type PurchaseOrderView = NonNullable<Awaited<ReturnType<typeof getPurchaseOrderView>>>;

/** Raw values for the PO edit form (cost users only). */
export async function getPurchaseOrderEditData(id: string, viewer: PermissionUser) {
  assertCosts(viewer);
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: {
        where: { removedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          salesOrderItem: { select: { qty: true, supplierUnitCost: true } },
          salesOrderItemComponent: { select: { qty: true, unitCost: true } },
        },
      },
    },
  });
  if (!po) return null;

  // Part B: the "Add from sales order" picker + "Changed vs SO" markers.
  // The picker lists this PO's own sales order's lines/components that still
  // have unordered qty and are not already on this PO.
  let soPicker: { soNumber: string; rows: SoPickerRow[] } | null = null;
  let soOrdered: Awaited<ReturnType<typeof loadOrderedQty>> | null = null;
  if (po.salesOrderId) {
    const so = await db.salesOrder.findUnique({
      where: { id: po.salesOrderId },
      select: {
        number: true,
        items: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true, description: true, kind: true, qty: true, unit: true, isLot: true,
            supplierId: true, supplierUnitCost: true,
            supplier: { select: { name: true } },
            components: {
              where: { removedAt: null },
              orderBy: { sortOrder: "asc" },
              select: {
                id: true, description: true, qty: true, unit: true,
                supplierId: true, unitCost: true,
                supplier: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (so) {
      const ordered = await loadOrderedQty(
        so.items.filter((i) => !i.isLot).map((i) => i.id),
        so.items.flatMap((i) => i.components.map((c) => c.id)),
        db,
      );
      soOrdered = ordered;
      const onThisPo = new Set(
        po.items.flatMap((i) => [i.salesOrderItemId, i.salesOrderItemComponentId]).filter((x): x is string => !!x),
      );
      soPicker = {
        soNumber: so.number,
        rows: buildSoPickerRows({
          lines: so.items.map((i) => ({
            id: i.id,
            description: i.description,
            kind: i.kind,
            qty: money(i.qty),
            unit: i.unit,
            supplierId: i.supplierId,
            supplierName: i.supplier?.name ?? null,
            unitCost: money(i.supplierUnitCost),
            isLot: i.isLot,
            components: i.components.map((c) => ({
              id: c.id,
              description: c.description,
              qty: money(c.qty),
              unit: c.unit,
              supplierId: c.supplierId,
              supplierName: c.supplier?.name ?? null,
              unitCost: money(c.unitCost),
            })),
          })),
          orderedLines: ordered.lines,
          orderedComponents: ordered.components,
          poSupplierId: po.supplierId,
          onThisPo,
        }),
      };
    }
  }

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
    items: po.items.map((i) => {
      const soQty = i.salesOrderItem ? money(i.salesOrderItem.qty) : i.salesOrderItemComponent ? money(i.salesOrderItemComponent.qty) : null;
      const bucket =
        i.salesOrderItemComponentId && soOrdered
          ? soOrdered.components.get(i.salesOrderItemComponentId)
          : i.salesOrderItemId && soOrdered
            ? soOrdered.lines.get(i.salesOrderItemId)
            : undefined;
      return {
        id: i.id,
        description: i.description,
        kind: i.kind,
        qty: money(i.qty),
        unit: i.unit,
        unitCost: money(i.unitCost),
        linked: !!(i.salesOrderItemId || i.salesOrderItemComponentId),
        salesOrderItemId: i.salesOrderItemId,
        salesOrderItemComponentId: i.salesOrderItemComponentId,
        // Marker reference: what the sales order itself says for this line.
        soQty,
        soUnitCost: i.salesOrderItem ? money(i.salesOrderItem.supplierUnitCost) : i.salesOrderItemComponent ? money(i.salesOrderItemComponent.unitCost) : null,
        // Over-order reference for the editor's live warning. Previously only
        // picker-added lines carried remainingQty, so saved over-ordered lines
        // never warned in the editor (read-only PO view did).
        remainingQty:
          soQty != null && soOrdered
            ? remainingQtyForExistingPoLine({ soQty, thisPoId: po.id, ordered: bucket })
            : null,
      };
    }),
    soPicker,
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
      items: {
        where: { removedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          supplier: { select: { id: true, name: true } },
          components: {
            where: { removedAt: null },
            orderBy: { sortOrder: "asc" },
            include: { supplier: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!so) return null;
  const lineIds = so.items.filter((i) => !i.isLot).map((i) => i.id);
  const componentIds = so.items.flatMap((i) => i.components.map((c) => c.id));
  const ordered = await loadOrderedQty(lineIds, componentIds, db);
  const lines = so.items.map((i) => {
    const bucket = ordered.lines.get(i.id);
    const orderedQty = i.isLot ? "0.00" : (bucket?.qty ?? "0.00");
    const soQty = money(i.qty);
    return {
      id: i.id,
      sortOrder: i.sortOrder,
      description: i.description,
      kind: i.kind,
      qty: soQty,
      unit: i.unit,
      supplierId: i.supplierId,
      supplierName: i.supplier?.name ?? null,
      supplierUnitCost: money(i.supplierUnitCost),
      orderedQty,
      remainingQty: i.isLot ? "0.00" : qtyLeft(soQty, orderedQty),
      purchaseOrders: bucket?.purchaseOrders ?? [],
      purchaseOrder: bucket?.purchaseOrders[0] ? { id: bucket.purchaseOrders[0].id, number: bucket.purchaseOrders[0].number } : null,
      isLot: i.isLot,
      components: i.components.map((c) => {
        const comp = ordered.components.get(c.id);
        const compOrdered = comp?.qty ?? "0.00";
        const compQty = money(c.qty);
        return {
          id: c.id,
          sortOrder: c.sortOrder,
          description: c.description,
          qty: compQty,
          unit: c.unit,
          supplierId: c.supplierId,
          supplierName: c.supplier?.name ?? null,
          unitCost: money(c.unitCost),
          orderedQty: compOrdered,
          remainingQty: qtyLeft(compQty, compOrdered),
          purchaseOrders: comp?.purchaseOrders ?? [],
          purchaseOrder: comp?.purchaseOrders[0] ? { id: comp.purchaseOrders[0].id, number: comp.purchaseOrders[0].number } : null,
        };
      }),
    };
  });
  const orderedQty = Object.fromEntries(lines.filter((l) => !l.isLot).map((l) => [l.id, l.orderedQty]));
  const orderedComponentQty = Object.fromEntries(lines.flatMap((l) => l.components.map((c) => [c.id, c.orderedQty])));
  const plan = planPurchaseOrders(lines, new Set(), {}, undefined, new Set(), new Set(), { orderedQty, orderedComponentQty });
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
  /** PO numbers; `total` only for cost users. */
  purchaseOrders: { id?: string; number: string; status: PoStatus }[];
};

/** Linked PO on a sales order; `total` only for cost users. */
export type SoPurchaseOrder = {
  id: string;
  number: string;
  status: PoStatus;
  supplierName: string;
  /** PO subtotal — cost users only. */
  total?: string;
};

export async function getSoPurchasing(salesOrderId: string, viewer: PermissionUser) {
  const withCosts = canSeeCosts(viewer);
  const [items, pos] = await Promise.all([
    db.salesOrderItem.findMany({
      where: { salesOrderId, removedAt: null },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        qty: true,
        isLot: true,
        components: {
          where: { removedAt: null },
          select: {
            qty: true,
            purchaseOrderItems: {
              where: { removedAt: null, purchaseOrder: { status: { not: "VOID" } } },
              select: { qty: true },
            },
          },
        },
        purchaseOrderItems: {
          where: { removedAt: null, purchaseOrder: { status: { not: "VOID" } } },
          select: {
            qty: true,
            receivedQty: true,
            salesOrderItemComponentId: true,
            purchaseOrder: { select: { id: true, number: true, status: true } },
          },
        },
      },
    }),
    db.purchaseOrder.findMany({
      where: { salesOrderId, status: { not: "VOID" } },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      select: {
        id: true,
        number: true,
        status: true,
        subtotal: true,
        supplier: { select: { name: true } },
      },
    }),
  ]);
  let fullyOrdered = 0;
  const lines: SoPurchasingLine[] = items.map((i) => {
    const p = soLineProgress(
      money(i.qty),
      i.purchaseOrderItems.map((x) => ({ qty: money(x.qty), receivedQty: money(x.receivedQty) })),
    );
    const seen = new Set<string>();
    const purchaseOrders = i.purchaseOrderItems
      .map((x) => x.purchaseOrder)
      .filter((po) => (seen.has(po.id) ? false : (seen.add(po.id), true)))
      .map((po) => ({ id: po.id, number: po.number, status: po.status }));
    // Coverage is remaining qty, not "a PO exists". Component buys of a lot
    // are not counted against the lot's own qty.
    const plain = i.purchaseOrderItems.filter((x) => !x.salesOrderItemComponentId);
    const needsMore = lineHasUnorderedQty({
      qty: money(i.qty),
      orderedQty: sumMoney(plain.map((x) => money(x.qty))),
      isLot: i.isLot,
      components: i.components.map((c) => ({
        qty: money(c.qty),
        orderedQty: sumMoney(c.purchaseOrderItems.map((x) => money(x.qty))),
      })),
    });
    if (!needsMore) fullyOrdered += 1;
    return { id: i.id, ...p, purchaseOrders };
  });
  // Audit F: the PO id is a link, not money — every viewer gets it. Only
  // the total stays cost-only.
  const purchaseOrders: SoPurchaseOrder[] = pos.map((po) => ({
    id: po.id,
    number: po.number,
    status: po.status,
    supplierName: po.supplier.name,
    ...(withCosts ? { total: money(po.subtotal) } : {}),
  }));
  return {
    lines,
    purchaseOrders,
    total: lines.length,
    received: lines.filter((l) => l.state === "RECEIVED").length,
    /** Lines whose required qty is fully on live, non-void POs. A partial line does not count. */
    ordered: fullyOrdered,
    /** True while any line (or lot component) still has quantity left to order. */
    needsMorePo: fullyOrdered < lines.length,
    canSeeCosts: withCosts,
  };
}

/**
 * Cost & margin tab on a sales order. Cost data only — returns null when the
 * viewer cannot see costs. Void POs / RRs / bills are excluded.
 */
export async function getSoCostMargin(salesOrderId: string, viewer: PermissionUser): Promise<CostMarginSummary | null> {
  if (!canSeeCosts(viewer)) return null;
  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      contractPrice: true,
      supplierCost: true,
      withholdingTotal: true,
      items: {
        where: { removedAt: null },
        select: {
          id: true,
          qty: true,
          isLot: true,
          purchaseOrderItems: {
            where: { removedAt: null, purchaseOrder: { status: { not: "VOID" } }, salesOrderItemComponentId: null },
            select: { qty: true },
          },
          components: {
            where: { removedAt: null },
            select: {
              qty: true,
              purchaseOrderItems: {
                where: { removedAt: null, purchaseOrder: { status: { not: "VOID" } } },
                select: { qty: true },
              },
            },
          },
        },
      },
    },
  });
  if (!so) return null;

  const pos = await db.purchaseOrder.findMany({
    where: { salesOrderId, status: { not: "VOID" } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    select: {
      id: true,
      number: true,
      status: true,
      subtotal: true,
      supplier: { select: { name: true } },
      receivingReports: {
        where: { status: "POSTED" },
        select: {
          items: {
            select: { qtyReceived: true, purchaseOrderItem: { select: { unitCost: true } } },
          },
        },
      },
      bills: {
        where: { status: "RECORDED" },
        select: { amount: true },
      },
    },
  });

  let uncoveredLineCount = 0;
  for (const item of so.items) {
    // Audit B4: a lot is covered when its COMPONENTS are ordered — the lot
    // line's own PO rows are only the component buys' parent links, never
    // counted against the lot's qty of 1.
    const uncovered = item.isLot
      ? item.components.some((c) => lineNeedsMorePo(money(c.qty), sumMoney(c.purchaseOrderItems.map((x) => money(x.qty)))))
      : lineNeedsMorePo(money(item.qty), sumMoney(item.purchaseOrderItems.map((x) => money(x.qty))));
    if (uncovered) uncoveredLineCount += 1;
  }

  const poInputs = pos.map((po) => {
    const receivedItems = po.receivingReports.flatMap((r) =>
      r.items.map((i) => ({ qtyReceived: money(i.qtyReceived), unitCost: money(i.purchaseOrderItem.unitCost) })),
    );
    const billedAmount = sumMoney(po.bills.map((b) => money(b.amount)));
    return {
      id: po.id,
      number: po.number,
      status: po.status,
      supplierName: po.supplier.name,
      poTotal: money(po.subtotal),
      receivedValue: valueReceived(receivedItems),
      billedAmount,
      hasBills: po.bills.length > 0,
      hasReceipts: po.receivingReports.length > 0,
    };
  });

  return buildCostMarginSummary({
    contractPrice: money(so.contractPrice),
    plannedCost: money(so.supplierCost),
    withholdingTotal: money(so.withholdingTotal),
    pos: poInputs,
    uncoveredLineCount,
  });
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
      status: { in: filter.history ? ["RECEIVED", "CLOSED"] : RECEIVABLE },
      ...(q
        ? {
            OR: [
              { number: { contains: q } },
              { supplier: { name: { contains: q } } },
              // S-48: search by a serial number received on this PO.
              { receivingReports: { some: { items: { some: { serialNumbers: { contains: q } } } } } },
            ],
          }
        : {}),
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
          items: { select: { purchaseOrderItemId: true, qtyReceived: true, warrantyEndDate: true, serialNumbers: true } },
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
      // Markers pair 4: the same coverage as words (short / full / over),
      // for screen readers and anywhere the bar alone is not enough.
      coverageNote: receivingCoverageNote({ orderedQty: money(i.qty), receivedQty: money(i.receivedQty), unit: i.unit }),
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
      items: r.items.map((x) => ({ description: desc.get(x.purchaseOrderItemId) ?? "(removed line)", qty: money(x.qtyReceived), warrantyEndDate: ymd(x.warrantyEndDate), serialNumbers: x.serialNumbers })),
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

// ---------------------------------------------------------------------------
// SL-05: warranties ending soon (POSTED RR lines only; no prices)
// ---------------------------------------------------------------------------

export type WarrantySoonRow = {
  id: string;
  warrantyEndDate: string;
  itemDescription: string;
  serialNumbers: string | null;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierName: string;
  salesOrderNumber: string | null;
};

const warrantySoonWhere = (now?: Date): Prisma.ReceivingReportItemWhereInput => {
  const { from, to } = warrantySoonWindow(manilaToday(now));
  return {
    warrantyEndDate: { gte: from, lte: to },
    receivingReport: { status: "POSTED" },
    purchaseOrderItem: { removedAt: null },
  };
};

/** Receiving lines whose supplier warranty ends in the next 30 Manila days, soonest first. */
export async function listWarrantiesEndingSoon(opts: { take?: number; now?: Date; q?: string } = {}): Promise<WarrantySoonRow[]> {
  const q = opts.q?.trim();
  const rows = await db.receivingReportItem.findMany({
    where: {
      ...warrantySoonWhere(opts.now),
      // The receiving page's warranty-soon toolbar promises search by PO
      // number, supplier, or serial (same contains pattern as
      // listReceivingView); the bell count stays unfiltered (no q passed).
      ...(q
        ? {
            OR: [
              { serialNumbers: { contains: q } },
              { purchaseOrderItem: { description: { contains: q } } },
              { receivingReport: { purchaseOrder: { number: { contains: q } } } },
              { receivingReport: { purchaseOrder: { supplier: { name: { contains: q } } } } },
              { receivingReport: { purchaseOrder: { salesOrder: { number: { contains: q } } } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      warrantyEndDate: true,
      serialNumbers: true,
      purchaseOrderItem: { select: { description: true } },
      receivingReport: {
        select: {
          purchaseOrder: {
            select: {
              id: true,
              number: true,
              supplier: { select: { name: true } },
              salesOrder: { select: { number: true } },
            },
          },
        },
      },
    },
    orderBy: [{ warrantyEndDate: "asc" }, { id: "asc" }],
    take: opts.take ?? 500,
  });
  return rows.map((r) => ({
    id: r.id,
    warrantyEndDate: ymd(r.warrantyEndDate)!,
    itemDescription: r.purchaseOrderItem.description,
    serialNumbers: r.serialNumbers,
    purchaseOrderId: r.receivingReport.purchaseOrder.id,
    purchaseOrderNumber: r.receivingReport.purchaseOrder.number,
    supplierName: r.receivingReport.purchaseOrder.supplier.name,
    salesOrderNumber: r.receivingReport.purchaseOrder.salesOrder?.number ?? null,
  }));
}

export async function countWarrantiesEndingSoon(now?: Date): Promise<number> {
  return db.receivingReportItem.count({ where: warrantySoonWhere(now) });
}

export { PO_STATUSES };
