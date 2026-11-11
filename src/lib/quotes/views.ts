// What the server sends to pages for quotes and sales orders.
//
// Costs rule: supplier, supplier unit cost/total, supplier cost and margins are
// OMITTED (the keys are never set) unless the viewer has "Can see costs". Pages
// must only pass these view objects to client components, never raw rows.
// tests/db/quotes.db.test.ts checks the payloads.

import type { Prisma, QuoteApprovalStatus, QuoteStatus, SalesOrderStatus } from "@prisma/client";
import { db } from "../db";
import { canApprove, canSeeCosts, type PermissionUser } from "../permissions";
import { QUOTE_APPROVAL_LABELS } from "./approval";
import { ACCEPTANCE_VIA_LABELS } from "./acceptance";
import {
  getSettingsSnapshot,
  getSettingsVersion,
  type SettingsSnapshot,
} from "../settings";
import { money, ymd } from "../documents/common";
import { addDays, manilaToday } from "../format";
import { lineNeedsMorePo, sumMoney } from "../purchasing/cost-margin";
import { loadOrderedQty } from "../purchasing/ordered";
import { remainingToBill } from "../billing/status";
import { COST_NOT_SET_LABEL, approvalReasons, docTotals, ratePctLabel, supplierCostStateFromSupplierTotals, toScaled, type ItemKind, type SupplierCostState, type WithholdingLine, type WithholdingSnapshot } from "./calc";
import { parseWithholdingPick } from "./withholding-defaults";
import { changedSummary, lineChangesVsQuote } from "./changed";
import { validityDaysFromDates } from "./validity";
import { snapshotList } from "../services/withholding";
import { customerBlockAddress } from "../services/addresses";
import { mergeCompanyLetterhead } from "../print/company";

type StoredMoney = {
  contractPrice: string;
  withholdingTotal: string;
  netReceived: string;
  supplierCost: string;
  netMargin: string;
  netMarginPct: string;
};

type Dec = { toFixed(n: number): string };

type ItemRow = {
  id: string;
  sortOrder: number;
  description: string;
  kind: ItemKind;
  qty: Dec;
  unit: string;
  supplierId: string | null;
  supplier?: { name: string } | null;
  supplierUnitCost: Dec;
  unitPrice: Dec;
  total: Dec;
  supplierTotal: Dec;
  margin: Dec;
  withholdingRate?: Dec | null;
  withholdingAtc?: string | null;
  withholdingOverride?: boolean;
  deliveredQty?: Dec | null;
  /** Part A markers (SO rows only): the quote line this line was copied from. */
  quoteItemId?: string | null;
  /** Catalog Step 3 (quotes only; SO rows have neither). */
  itemId?: string | null;
  item?: { name: string } | null;
  /** Lot (bundle) lines and their internal components (quotes and SOs). */
  isLot?: boolean;
  components?: {
    id: string;
    itemId: string | null;
    description: string;
    qty: Dec;
    unit: string;
    supplierId: string | null;
    supplier?: { name: string } | null;
    unitCost: Dec;
  }[];
};

export type ItemView = {
  id: string;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  unitPrice: string;
  total: string;
  deliveredQty?: string;
  /** Snapshotted withholding on the line (staff views / editor). */
  withholdingRate: string | null;
  withholdingAtc: string | null;
  withholdingOverride: boolean;
  /** Part A: "Changed vs quote" differences (SO views only; set by
   * getSalesOrderView when the line's quoteItemId resolves). */
  changedVsQuote?: string[];
  /** Part A: the tap/hover text — "Quote: 10 pcs @ ₱…, now 12 pcs @ ₱…". */
  changedSummary?: string;
  // Cost users only:
  supplierId?: string | null;
  supplierName?: string | null;
  supplierUnitCost?: string;
  supplierTotal?: string;
  margin?: string;
  /** Catalog Step 3: the linked catalog item (quotes only). */
  itemId?: string | null;
  itemName?: string | null;
  /** Lot (bundle) line + its internal components (cost users only). */
  isLot: boolean;
  components?: ItemComponentView[];
};

export type ItemComponentView = {
  id: string;
  itemId: string | null;
  description: string;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: string;
};

export type TotalsView = {
  contractPrice: string;
  withholding: (WithholdingLine & { pctLabel: string })[];
  withholdingTotal: string;
  netReceived: string;
  // Cost users only:
  supplierCost?: string;
  netMargin?: string;
  netMarginPct?: string;
  supplierCostState?: SupplierCostState;
};

function itemView(i: ItemRow, withCosts: boolean): ItemView {
  const base: ItemView = {
    id: i.id,
    description: i.description,
    kind: i.kind,
    qty: money(i.qty),
    unit: i.unit,
    unitPrice: money(i.unitPrice),
    total: money(i.total),
    deliveredQty: "deliveredQty" in i && i.deliveredQty != null ? money(i.deliveredQty as Dec) : "0.00",
    withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
    withholdingAtc: i.withholdingAtc ?? null,
    withholdingOverride: i.withholdingOverride ?? false,
    itemId: i.itemId ?? null,
    itemName: i.item?.name ?? null,
    isLot: i.isLot ?? false,
  };
  if (!withCosts) return base;
  return {
    ...base,
    supplierId: i.supplierId,
    supplierName: i.supplier?.name ?? null,
    supplierUnitCost: money(i.supplierUnitCost),
    supplierTotal: money(i.supplierTotal),
    margin: money(i.margin),
    components: (i.components ?? []).map((c) => ({
      id: c.id,
      itemId: c.itemId,
      description: c.description,
      qty: money(c.qty),
      unit: c.unit,
      supplierId: c.supplierId,
      supplierName: c.supplier?.name ?? null,
      unitCost: money(c.unitCost),
    })),
  };
}

/**
 * Display totals. Money fields always come from the stored document row so
 * legacy lines with NULL rates never silently change issued/won/void totals.
 * Itemisation uses per-line rates when every line is snapshotted; otherwise
 * the stored document withholding JSON (rates only — amounts left blank-safe).
 */
function totalsView(items: ItemRow[], withholding: WithholdingSnapshot[], stored: StoredMoney, withCosts: boolean): TotalsView {
  const lineInputs = items.map((i) => ({
    kind: i.kind,
    total: money(i.total),
    supplierTotal: money(i.supplierTotal),
    margin: money(i.margin),
    withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
    withholdingAtc: i.withholdingAtc ?? null,
  }));
  // Prefer stored document withholding JSON as the pick list (one row per rate,
  // whole-total rates as their own lines). Fall back to line grouping only when
  // the JSON is empty but every line is snapshotted.
  const picks = withholding.length > 0 ? withholding : undefined;
  const allSnapshotted = lineInputs.length > 0 && lineInputs.every((i) => i.withholdingRate != null);
  const itemised: (WithholdingLine & { pctLabel: string })[] =
    picks || allSnapshotted
      ? docTotals(lineInputs, picks).withholding.map((w) => ({ ...w, pctLabel: ratePctLabel(w.rate) }))
      : [];
  const base: TotalsView = {
    contractPrice: stored.contractPrice,
    withholding: itemised,
    // Always the stored total; when picks drove the save, it equals sum(parts).
    withholdingTotal: stored.withholdingTotal,
    netReceived: stored.netReceived,
  };
  if (!withCosts) return base;
  return {
    ...base,
    supplierCost: stored.supplierCost,
    netMargin: stored.netMargin,
    netMarginPct: stored.netMarginPct,
    supplierCostState: supplierCostStateFromSupplierTotals(lineInputs.map((i) => i.supplierTotal)),
  };
}

function approvalFromSnap(
  snap: SettingsSnapshot,
  contractPrice: string,
  netMarginPct: string,
  withCosts: boolean,
  supplierCostState: SupplierCostState,
) {
  const reasons = approvalReasons({ contractPrice, netMarginPct, supplierCostState }, snap.settings.approval);
  // Staff who cannot see costs must not get a "low margin" chip for a missing cost.
  const visible = withCosts ? reasons : reasons.filter((r) => r !== COST_NOT_SET_LABEL);
  return { needed: visible.length > 0, reasons: visible };
}

async function approvalFor(
  settingsVersionId: string,
  contractPrice: string,
  netMarginPct: string,
  withCosts: boolean,
  supplierCostState: SupplierCostState,
) {
  const snap = (await getSettingsVersion(settingsVersionId)) ?? (await getSettingsSnapshot());
  return approvalFromSnap(snap, contractPrice, netMarginPct, withCosts, supplierCostState);
}

const itemsInclude = {
  where: { removedAt: null },
  orderBy: { sortOrder: "asc" },
  include: { supplier: { select: { name: true } } },
} satisfies Prisma.QuoteItemFindManyArgs;

/** Sales orders: items plus their lot components (SO lines have no catalog link). */
const soItemsInclude = {
  where: { removedAt: null },
  orderBy: { sortOrder: "asc" },
  include: {
    supplier: { select: { name: true } },
    components: {
      where: { removedAt: null },
      orderBy: { sortOrder: "asc" },
      include: { supplier: { select: { name: true } } },
    },
  },
} satisfies Prisma.SalesOrderItemFindManyArgs;

/** Quotes only: the catalog link exists only on quote lines. Prints use
 * itemsInclude (line face only; components never print). */
const quoteItemsInclude = {
  where: { removedAt: null },
  orderBy: { sortOrder: "asc" },
  include: {
    supplier: { select: { name: true } },
    item: { select: { name: true } },
    components: {
      where: { removedAt: null },
      orderBy: { sortOrder: "asc" },
      include: { supplier: { select: { name: true } } },
    },
  },
} satisfies Prisma.QuoteItemFindManyArgs;

const contactSelect = { id: true, name: true, email: true, phone: true } as const;

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export async function getQuoteView(id: string, viewer: PermissionUser) {
  const withCosts = canSeeCosts(viewer);
  const q = await db.quote.findUnique({
    where: { id },
    include: {
      items: quoteItemsInclude,
      customer: { select: { id: true, name: true, address: true, tin: true, active: true, withholdingType: true } },
      contact: { select: contactSelect },
      // Every SO made from this quote, voided ones included.
      salesOrders: { select: { id: true, number: true, status: true, date: true, buyerPoNo: true, voidReason: true }, orderBy: [{ createdAt: "desc" }, { number: "desc" }] },
      createdBy: { select: { id: true, name: true, position: true, signatureStorageKey: true } },
      preparedBy: { select: { id: true, name: true, position: true, signatureStorageKey: true } },
      attachments: { where: { archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, createdAt: true } },
      updatedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
    },
  });
  if (!q) return null;
  const withholding = snapshotList(q.withholding);
  const withholdingPick = parseWithholdingPick(q.withholdingPick);
  const stored = {
    contractPrice: money(q.contractPrice),
    withholdingTotal: money(q.withholdingTotal),
    netReceived: money(q.netReceived),
    supplierCost: money(q.supplierCost),
    netMargin: money(q.netMargin),
    netMarginPct: money(q.netMarginPct),
  };
  const totals = totalsView(q.items, withholding, stored, withCosts);
  const approvalStatus = q.approvalStatus;
  return {
    id: q.id,
    number: q.number,
    revision: q.revision,
    status: q.status,
    approvalStatus,
    approvalLabel: QUOTE_APPROVAL_LABELS[approvalStatus],
    approvedBy: q.approvedBy?.name ?? null,
    approvedAt: q.approvedAt,
    acceptedAt: q.acceptedAt,
    acceptedBy: q.acceptedBy,
    acceptedVia: q.acceptedVia,
    acceptedViaLabel: q.acceptedVia ? ACCEPTANCE_VIA_LABELS[q.acceptedVia] ?? q.acceptedVia : null,
    hasAcceptance: q.acceptedAt !== null || q.attachments.length > 0,
    rejectedBy: q.rejectedBy?.name ?? null,
    rejectedAt: q.rejectedAt,
    rejectReason: q.rejectReason,
    canApproveWorkflow: canApprove(viewer) && q.status !== "VOID" && approvalStatus === "PENDING",
    isWorkflowApproved: approvalStatus === "APPROVED",
    date: ymd(q.date)!,
    validUntil: ymd(q.validUntil)!,
    validityDays: validityDaysFromDates(q.date, q.validUntil),
    terms: q.terms,
    notes: q.notes,
    deliveryNotes: q.deliveryNotes,
    warrantyNotes: q.warrantyNotes,
    leadTimeDays: q.leadTimeDays,
    internalNotes: q.internalNotes,
    subject: q.subject,
    buyerPoNo: q.buyerPoNo,
    deliveryAddressId: q.deliveryAddressId,
    deliveryAddressText: q.deliveryAddressText,
    voidReason: q.voidReason,
    customer: q.customer,
    contact: q.contact,
    withholding,
    withholdingPick,
    items: q.items.map((i) => itemView(i, withCosts)),
    totals,
    approval: await approvalFor(
      q.settingsVersionId,
      money(q.contractPrice),
      money(q.netMarginPct),
      withCosts,
      supplierCostStateFromSupplierTotals(q.items.map((i) => money(i.supplierTotal))),
    ),
    salesOrders: q.salesOrders.map((s) => ({ ...s, date: ymd(s.date)! })),
    createdBy: q.createdBy.name,
    createdByPosition: q.createdBy.position,
    createdBySignatureUrl: q.createdBy.signatureStorageKey ? `/files/user-signature/${q.createdBy.id}` : null,
    // Preparer picker: the chosen preparer, else the creator.
    preparedById: q.preparedBy?.id ?? q.createdBy.id,
    preparedBy: (q.preparedBy ?? q.createdBy).name,
    preparedByPosition: (q.preparedBy ?? q.createdBy).position,
    preparedBySignatureUrl: (q.preparedBy ?? q.createdBy).signatureStorageKey
      ? `/files/user-signature/${(q.preparedBy ?? q.createdBy).id}`
      : null,
    conformeFiles: q.attachments.map((a) => ({ id: a.id, fileName: a.fileName, href: `/files/attachments/${a.id}` })),
    updatedBy: q.updatedBy.name,
    updatedAt: q.updatedAt,
    settingsVersionId: q.settingsVersionId,
    canSeeCosts: withCosts,
  };
}
export type QuoteView = NonNullable<Awaited<ReturnType<typeof getQuoteView>>>;

export const QUOTE_STATUSES: QuoteStatus[] = ["DRAFT", "SENT", "WON", "LOST", "VOID"];

export type QuoteListFilter = {
  q?: string;
  status?: QuoteStatus;
  /** Quotes with workflow approvalStatus PENDING (non-void). Home Waiting list. */
  needsApproval?: boolean;
  /** Sent quotes whose quote date is on or before Manila today − N days. */
  noReplyAfterDays?: number;
  /** DRAFT + SENT only (Home Pipeline / open filter). Overrides single status. */
  open?: boolean;
  /** Optional clock for no-reply cutoff (tests). */
  now?: Date;
};

export async function listQuotesView(filter: QuoteListFilter, viewer: PermissionUser) {
  const withCosts = canSeeCosts(viewer);
  const q = filter.q?.trim();
  const needsApproval = filter.needsApproval === true;
  const openOnly = filter.open === true;
  const noReplyAfterDays =
    typeof filter.noReplyAfterDays === "number" && filter.noReplyAfterDays > 0 ? filter.noReplyAfterDays : undefined;

  let status = filter.status;
  if (noReplyAfterDays) status = "SENT";

  const where: Prisma.QuoteWhereInput = {
    ...(needsApproval
      ? // Open quotes only — WON/LOST/VOID stay out of the Waiting list.
        { approvalStatus: "PENDING" satisfies QuoteApprovalStatus, status: { in: ["DRAFT", "SENT"] } }
      : openOnly && !noReplyAfterDays
        ? { status: { in: ["DRAFT", "SENT"] } }
        : status
          ? { status }
          : {}),
    ...(q ? { OR: [{ number: { contains: q } }, { customer: { name: { contains: q } } }] } : {}),
  };

  if (noReplyAfterDays) {
    const cutoff = addDays(manilaToday(filter.now), -noReplyAfterDays);
    where.date = { lte: cutoff };
  }

  const rows = await db.quote.findMany({
    where,
    include: { customer: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 500,
  });

  const mapped = rows.map((r) => {
    const row = {
      id: r.id,
      number: r.number,
      revision: r.revision,
      customerName: r.customer.name,
      contractPrice: money(r.contractPrice),
      status: r.status,
      approvalStatus: r.approvalStatus,
      date: ymd(r.date)!,
      validUntil: ymd(r.validUntil)!,
    };
    return withCosts ? { ...row, netMarginPct: money(r.netMarginPct) } : row;
  });

  return mapped as ({
    id: string;
    number: string;
    revision: number;
    customerName: string;
    contractPrice: string;
    status: QuoteStatus;
    approvalStatus: QuoteApprovalStatus;
    date: string;
    validUntil: string;
    netMarginPct?: string;
  })[];
}

// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------

export async function getSalesOrderView(id: string, viewer: PermissionUser) {
  const withCosts = canSeeCosts(viewer);
  const so = await db.salesOrder.findUnique({
    where: { id },
    include: {
      items: soItemsInclude,
      customer: { select: { id: true, name: true, address: true, tin: true, active: true, withholdingType: true } },
      contact: { select: contactSelect },
      quote: { select: { id: true, number: true, status: true, date: true, contractPrice: true } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!so) return null;
  const withholding = snapshotList(so.withholding);
  const stored = {
    contractPrice: money(so.contractPrice),
    withholdingTotal: money(so.withholdingTotal),
    netReceived: money(so.netReceived),
    supplierCost: money(so.supplierCost),
    netMargin: money(so.netMargin),
    netMarginPct: money(so.netMarginPct),
  };
  // Part A markers: compare each SO line with the quote line it was copied
  // from (quoteItemId, stamped at conversion; NULL on older SOs = no marker).
  const quoteItemIds = so.items.map((i) => i.quoteItemId).filter((x): x is string => !!x);
  let quoteItems = quoteItemIds.length
    ? await db.quoteItem.findMany({
        where: { id: { in: quoteItemIds } },
        select: { id: true, qty: true, unit: true, unitPrice: true, kind: true, withholdingRate: true, withholdingAtc: true },
      })
    : [];
  // Fallback for SOs converted BEFORE the quoteItemId stamp existed (their
  // lines carry NULL): match quote lines by sortOrder only when identity is
  // still proven — equal counts, unique sortOrders on BOTH sides, and every
  // SO line's description still equals the quote line at that sortOrder
  // (descriptions must also be unique so identical-text lines can't swap
  // unnoticed). SO ↑/↓ reorder renumbers sortOrder to 1..n; without the
  // description check that would pair the wrong quote line. Any doubt → no
  // marker, never a wrong one. Found by staging QA 2026-11-11: SO-2026-0006.
  if (!quoteItems.length && so.items.length > 0) {
    const all = await db.quoteItem.findMany({
      where: { quoteId: so.quote.id, removedAt: null },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        sortOrder: true,
        description: true,
        qty: true,
        unit: true,
        unitPrice: true,
        kind: true,
        withholdingRate: true,
        withholdingAtc: true,
      },
    });
    if (all.length === so.items.length) {
      const bySort = new Map(all.map((q) => [q.sortOrder, q]));
      const soBySort = new Map(so.items.map((i) => [i.sortOrder, i]));
      const quoteDescs = new Set(all.map((q) => q.description));
      const soDescs = new Set(so.items.map((i) => i.description));
      // Fail closed: duplicate sortOrders or duplicate descriptions mean we
      // cannot prove which line is which after a possible reorder.
      if (
        bySort.size === all.length &&
        soBySort.size === so.items.length &&
        quoteDescs.size === all.length &&
        soDescs.size === so.items.length
      ) {
        const linked = new Map<string, (typeof all)[number]>();
        let ok = true;
        for (const i of so.items) {
          const q = bySort.get(i.sortOrder);
          // Description must still match at this sortOrder — the stable
          // identity beyond renumberable sortOrder (CTO review #198).
          if (!q || q.description !== i.description) {
            ok = false;
            break;
          }
          linked.set(i.id, q);
        }
        if (ok) {
          quoteItems = all;
          for (const i of so.items) {
            if (!i.quoteItemId) (i as { quoteItemId?: string | null }).quoteItemId = linked.get(i.id)!.id;
          }
        }
      }
    }
  }
  const quoteItemById = new Map(quoteItems.map((q) => [q.id, q]));
  const itemViews = so.items.map((i) => {
    const view = itemView(i, withCosts);
    const q = i.quoteItemId ? quoteItemById.get(i.quoteItemId) : undefined;
    if (q) {
      const rate = (v: { toFixed(n: number): string } | null) => (v != null ? Number(v.toString()).toFixed(4) : null);
      const changes = lineChangesVsQuote(
        { qty: view.qty, unitPrice: view.unitPrice, kind: view.kind, withholdingRate: view.withholdingRate, withholdingAtc: view.withholdingAtc },
        { qty: money(q.qty), unitPrice: money(q.unitPrice), kind: q.kind, withholdingRate: rate(q.withholdingRate), withholdingAtc: q.withholdingAtc ?? null },
      );
      if (changes.length) {
        view.changedVsQuote = changes.map((c) => c.label);
        view.changedSummary = changedSummary(
          { qty: view.qty, unit: view.unit, unitPrice: view.unitPrice, kind: view.kind, withholdingRate: view.withholdingRate, withholdingAtc: view.withholdingAtc },
          { qty: money(q.qty), unit: q.unit, unitPrice: money(q.unitPrice), kind: q.kind, withholdingRate: rate(q.withholdingRate), withholdingAtc: q.withholdingAtc ?? null },
        );
      }
    }
    return view;
  });
  const changedLineCount = itemViews.filter((v) => v.changedVsQuote?.length).length;
  return {
    id: so.id,
    number: so.number,
    trackingRef: so.trackingRef,
    status: so.status,
    date: ymd(so.date)!,
    buyerPoNo: so.buyerPoNo,
    buyerPoDate: ymd(so.buyerPoDate),
    deliveryAddress: so.deliveryAddress,
    terms: so.terms,
    notes: so.notes,
    philgepsRef: so.philgepsRef,
    bidNo: so.bidNo,
    noaDate: ymd(so.noaDate),
    agencyPoNo: so.agencyPoNo,
    iarDate: ymd(so.iarDate),
    voidReason: so.voidReason,
    customer: so.customer,
    contact: so.contact,
    quote: { id: so.quote.id, number: so.quote.number, status: so.quote.status, date: ymd(so.quote.date), contractPrice: money(so.quote.contractPrice) },
    withholding,
    items: itemViews,
    /** Part A: how many lines differ from the quote (0 = no summary line). */
    changedLineCount,
    totals: totalsView(so.items, withholding, stored, withCosts),
    approval: await approvalFor(
      so.settingsVersionId,
      money(so.contractPrice),
      money(so.netMarginPct),
      withCosts,
      supplierCostStateFromSupplierTotals(so.items.map((i) => money(i.supplierTotal))),
    ),
    createdBy: so.createdBy.name,
    updatedBy: so.updatedBy.name,
    settingsVersionId: so.settingsVersionId,
    canSeeCosts: withCosts,
  };
}
export type SalesOrderView = NonNullable<Awaited<ReturnType<typeof getSalesOrderView>>>;

export const SALES_ORDER_STATUSES: SalesOrderStatus[] = ["OPEN", "VOID", "CLOSED"];

export type SalesOrderListFilter = {
  q?: string;
  status?: SalesOrderStatus;
  /** Open SOs with at least one line still short of supplier PO coverage. */
  needsPo?: boolean;
  /** OPEN SOs with remaining-to-bill &gt; 0 (Home Pipeline / open filter). */
  open?: boolean;
};

export async function listSalesOrdersView(filter: SalesOrderListFilter) {
  const q = filter.q?.trim();
  const needsPo = filter.needsPo === true;
  const openUnbilled = filter.open === true;
  const status = needsPo || openUnbilled ? "OPEN" : filter.status;
  const where: Prisma.SalesOrderWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q } },
            { buyerPoNo: { contains: q } },
            { customer: { name: { contains: q } } },
            // S-48: search by a serial number delivered on this order.
            { deliveries: { some: { items: { some: { serialNumbers: { contains: q } } } } } },
          ],
        }
      : {}),
  };

  if (!needsPo) {
    const rows = await db.salesOrder.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        ...(openUnbilled
          ? { billings: { where: { status: { not: "VOID" } }, select: { amount: true } } }
          : {}),
      },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 500,
    });
    type Row = (typeof rows)[number] & { billings?: { amount: unknown }[] };
    const mapped = [];
    for (const raw of rows as Row[]) {
      const contractPrice = money(raw.contractPrice);
      if (openUnbilled) {
        const billed = (raw.billings ?? []).map((b) => money(b.amount));
        if (toScaled(remainingToBill(contractPrice, billed), 2) <= 0n) continue;
      }
      mapped.push({
        id: raw.id,
        number: raw.number,
        customerName: raw.customer.name,
        buyerPoNo: raw.buyerPoNo,
        contractPrice,
        status: raw.status,
        date: ymd(raw.date)!,
      });
    }
    return mapped;
  }

  const rows = await db.salesOrder.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      items: {
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
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 500,
  });

  return rows
    .filter((r) =>
      r.items.some((item) => {
        const ordered = sumMoney(item.purchaseOrderItems.map((x) => money(x.qty)));
        return lineNeedsMorePo(money(item.qty), ordered);
      }),
    )
    .map((r) => ({
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      buyerPoNo: r.buyerPoNo,
      contractPrice: money(r.contractPrice),
      status: r.status,
      date: ymd(r.date)!,
    }));
}

// ---------------------------------------------------------------------------
// Print (customer-facing): never any costs, margins or withholding breakdown.
// ---------------------------------------------------------------------------

export type PrintItem = { description: string; qty: string; unit: string; unitPrice: string; total: string };

export type PrintDoc = {
  title: "Quotation" | "Sales Order";
  number: string;
  status: string;
  date: string;
  validUntil: string | null;
  buyerPoNo: string | null;
  buyerPoDate: string | null;
  deliveryAddress: string | null;
  company: { name: string; tin: string; address: string };
  customer: { name: string; address: string | null; tin: string | null };
  contact: { name: string; email: string | null; phone: string | null } | null;
  items: PrintItem[];
  contractPrice: string;
  terms: string | null;
  /** Customer notes only — internal notes must never appear on print models. */
  notes: string | null;
  subject: string | null;
};

const printItem = (i: ItemRow): PrintItem => ({ description: i.description, qty: money(i.qty), unit: i.unit, unitPrice: money(i.unitPrice), total: money(i.total) });

/** Pinned-first letterhead; blank pinned fields fall back to current Settings. */
async function companyFor(settingsVersionId: string) {
  const latest = await getSettingsSnapshot();
  const pinned = await getSettingsVersion(settingsVersionId);
  return mergeCompanyLetterhead(pinned?.settings.company, latest.settings.company);
}

export async function getQuotePrint(id: string): Promise<PrintDoc | null> {
  const q = await db.quote.findUnique({
    where: { id },
    include: { items: itemsInclude, customer: true, contact: { select: contactSelect } },
  });
  if (!q) return null;
  return {
    title: "Quotation",
    number: q.number,
    status: q.status,
    date: ymd(q.date)!,
    validUntil: ymd(q.validUntil),
    buyerPoNo: q.buyerPoNo,
    buyerPoDate: null,
    deliveryAddress: null,
    company: await companyFor(q.settingsVersionId),
    customer: { name: q.customer.name, address: await customerBlockAddress(q.customer), tin: q.customer.tin },
    contact: q.contact ? { name: q.contact.name, email: q.contact.email, phone: q.contact.phone } : null,
    items: q.items.map(printItem),
    contractPrice: money(q.contractPrice),
    terms: q.terms,
    // Customer notes only — internalNotes must never appear here.
    notes: q.notes,
    subject: q.subject,
  };
}

export async function getSalesOrderPrint(id: string): Promise<PrintDoc | null> {
  const so = await db.salesOrder.findUnique({
    where: { id },
    include: { items: itemsInclude, customer: true, contact: { select: contactSelect } },
  });
  if (!so) return null;
  return {
    title: "Sales Order",
    number: so.number,
    status: so.status,
    date: ymd(so.date)!,
    validUntil: null,
    buyerPoNo: so.buyerPoNo,
    buyerPoDate: ymd(so.buyerPoDate),
    deliveryAddress: so.deliveryAddress,
    company: await companyFor(so.settingsVersionId),
    customer: { name: so.customer.name, address: await customerBlockAddress(so.customer), tin: so.customer.tin },
    contact: so.contact ? { name: so.contact.name, email: so.contact.email, phone: so.contact.phone } : null,
    items: so.items.map(printItem),
    contractPrice: money(so.contractPrice),
    terms: so.terms,
    notes: so.notes,
    subject: null,
  };
}

/** Raw rows for the edit forms (Draft/Sent quote, Open SO). Cost fields only for cost users. */
export type EditableItem = {
  id: string;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  unitPrice: string;
  withholdingRate: string | null;
  withholdingAtc: string | null;
  withholdingOverride: boolean;
  supplierId?: string | null;
  supplierUnitCost?: string;
  /** Catalog Step 3: the linked catalog item (quotes only; null for SO). */
  itemId?: string | null;
  itemName?: string | null;
  /** Lot (bundle) line + components (quotes only, cost users only). */
  isLot?: boolean;
  components?: ItemComponentView[];
  /** SO editor only (Part A audit A7): qty already on live POs / delivered,
   * for the per-line floor notes. Display only. */
  orderedQty?: string;
  deliveredQty?: string;
};

export function editableItems(items: ItemView[], withCosts: boolean): EditableItem[] {
  return items.map((i) => {
    const base = {
      id: i.id,
      description: i.description,
      kind: i.kind,
      qty: i.qty,
      unit: i.unit,
      unitPrice: i.unitPrice,
      withholdingRate: i.withholdingRate,
      withholdingAtc: i.withholdingAtc,
      withholdingOverride: i.withholdingOverride,
      itemId: i.itemId ?? null,
      itemName: i.itemName ?? null,
      deliveredQty: i.deliveredQty,
    };
    return withCosts
      ? {
          ...base,
          supplierId: i.supplierId ?? null,
          supplierUnitCost: i.supplierUnitCost ?? "0.00",
          isLot: i.isLot ?? false,
          components: i.components ?? [],
        }
      : base;
  });
}

/**
 * Part A (audit A7): per-line ordered quantities for the SO editor's floor
 * notes — how much of each plain line is already on live POs, from the ONE
 * ordered-qty helper. Lot lines are skipped (their components carry the PO
 * links; the editor's lot lines are not qty-editable anyway).
 */
export async function soLineOrderedQty(soId: string): Promise<Map<string, string>> {
  const items = await db.salesOrderItem.findMany({
    where: { salesOrderId: soId, removedAt: null, isLot: false },
    select: { id: true },
  });
  if (!items.length) return new Map();
  const { lines } = await loadOrderedQty(items.map((i) => i.id), [], db);
  return new Map([...lines.entries()].map(([id, v]) => [id, v.qty]));
}

export type { WithholdingSnapshot };
