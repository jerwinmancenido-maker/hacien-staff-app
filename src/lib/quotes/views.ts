// What the server sends to pages for quotes and sales orders.
//
// Costs rule: supplier, supplier unit cost/total, supplier cost and margins are
// OMITTED (the keys are never set) unless the viewer has "Can see costs". Pages
// must only pass these view objects to client components, never raw rows.
// tests/db/quotes.db.test.ts checks the payloads.

import type { Prisma, QuoteStatus, SalesOrderStatus } from "@prisma/client";
import { db } from "../db";
import { canSeeCosts, type PermissionUser } from "../permissions";
import {
  getSettingsSnapshot,
  getSettingsVersion,
  getSettingsVersionsMap,
  type SettingsSnapshot,
} from "../settings";
import { money, ymd } from "../documents/common";
import { addDays, manilaToday } from "../format";
import { lineNeedsMorePo, sumMoney } from "../purchasing/cost-margin";
import { approvalReasons, docTotals, ratePctLabel, type ItemKind, type WithholdingLine, type WithholdingSnapshot } from "./calc";
import { snapshotList } from "../services/withholding";
import { customerBlockAddress } from "../services/addresses";

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
};

export type ItemView = {
  id: string;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  unitPrice: string;
  total: string;
  // Cost users only:
  supplierId?: string | null;
  supplierName?: string | null;
  supplierUnitCost?: string;
  supplierTotal?: string;
  margin?: string;
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
  };
  if (!withCosts) return base;
  return {
    ...base,
    supplierId: i.supplierId,
    supplierName: i.supplier?.name ?? null,
    supplierUnitCost: money(i.supplierUnitCost),
    supplierTotal: money(i.supplierTotal),
    margin: money(i.margin),
  };
}

function totalsView(items: ItemRow[], withholding: WithholdingSnapshot[], withCosts: boolean): TotalsView {
  const t = docTotals(
    items.map((i) => ({ kind: i.kind, total: money(i.total), supplierTotal: money(i.supplierTotal), margin: money(i.margin) })),
    withholding,
  );
  const base: TotalsView = {
    contractPrice: t.contractPrice,
    withholding: t.withholding.map((w) => ({ ...w, pctLabel: ratePctLabel(w.rate) })),
    withholdingTotal: t.withholdingTotal,
    netReceived: t.netReceived,
  };
  if (!withCosts) return base;
  return { ...base, supplierCost: t.supplierCost, netMargin: t.netMargin, netMarginPct: t.netMarginPct };
}

function approvalFromSnap(
  snap: SettingsSnapshot,
  contractPrice: string,
  netMarginPct: string,
  withCosts: boolean,
) {
  const reasons = approvalReasons({ contractPrice, netMarginPct }, snap.settings.approval);
  return withCosts ? { needed: reasons.length > 0, reasons } : { needed: reasons.length > 0 };
}

async function approvalFor(settingsVersionId: string, contractPrice: string, netMarginPct: string, withCosts: boolean) {
  const snap = (await getSettingsVersion(settingsVersionId)) ?? (await getSettingsSnapshot());
  return approvalFromSnap(snap, contractPrice, netMarginPct, withCosts);
}

const itemsInclude = {
  where: { removedAt: null },
  orderBy: { sortOrder: "asc" },
  include: { supplier: { select: { name: true } } },
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
      items: itemsInclude,
      customer: { select: { id: true, name: true, address: true, tin: true, active: true } },
      contact: { select: contactSelect },
      // Every SO made from this quote, voided ones included.
      salesOrders: { select: { id: true, number: true, status: true, date: true, buyerPoNo: true, voidReason: true }, orderBy: [{ createdAt: "desc" }, { number: "desc" }] },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!q) return null;
  const withholding = snapshotList(q.withholding);
  const totals = totalsView(q.items, withholding, withCosts);
  return {
    id: q.id,
    number: q.number,
    revision: q.revision,
    status: q.status,
    date: ymd(q.date)!,
    validUntil: ymd(q.validUntil)!,
    terms: q.terms,
    notes: q.notes,
    voidReason: q.voidReason,
    customer: q.customer,
    contact: q.contact,
    withholding,
    items: q.items.map((i) => itemView(i, withCosts)),
    totals,
    approval: await approvalFor(q.settingsVersionId, money(q.contractPrice), money(q.netMarginPct), withCosts),
    salesOrders: q.salesOrders.map((s) => ({ ...s, date: ymd(s.date)! })),
    createdBy: q.createdBy.name,
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
  /** Draft quotes that need approval under their settings version. */
  needsApproval?: boolean;
  /** Sent quotes whose quote date is on or before Manila today − N days. */
  noReplyAfterDays?: number;
  /** Optional clock for no-reply cutoff (tests). */
  now?: Date;
};

export async function listQuotesView(filter: QuoteListFilter, viewer: PermissionUser) {
  const withCosts = canSeeCosts(viewer);
  const q = filter.q?.trim();
  const needsApproval = filter.needsApproval === true;
  const noReplyAfterDays =
    typeof filter.noReplyAfterDays === "number" && filter.noReplyAfterDays > 0 ? filter.noReplyAfterDays : undefined;

  let status = filter.status;
  if (needsApproval) status = "DRAFT";
  if (noReplyAfterDays) status = "SENT";

  const where: Prisma.QuoteWhereInput = {
    ...(status ? { status } : {}),
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

  let mapped = rows.map((r) => {
    const row = {
      id: r.id,
      number: r.number,
      revision: r.revision,
      customerName: r.customer.name,
      contractPrice: money(r.contractPrice),
      status: r.status,
      date: ymd(r.date)!,
      validUntil: ymd(r.validUntil)!,
      settingsVersionId: r.settingsVersionId,
      netMarginPctStored: money(r.netMarginPct),
    };
    return withCosts ? { ...row, netMarginPct: money(r.netMarginPct) } : row;
  });

  if (needsApproval) {
    const snaps = await getSettingsVersionsMap(mapped.map((r) => r.settingsVersionId));
    const fallback = await getSettingsSnapshot();
    mapped = mapped.filter((r) => {
      const snap = snaps.get(r.settingsVersionId) ?? fallback;
      return approvalFromSnap(snap, r.contractPrice, r.netMarginPctStored, withCosts).needed;
    });
  }

  return mapped.map(({ settingsVersionId: _s, netMarginPctStored: _n, ...rest }) => rest) as ({
    id: string;
    number: string;
    revision: number;
    customerName: string;
    contractPrice: string;
    status: QuoteStatus;
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
      items: itemsInclude,
      customer: { select: { id: true, name: true, address: true, tin: true, active: true } },
      contact: { select: contactSelect },
      quote: { select: { id: true, number: true, status: true } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!so) return null;
  const withholding = snapshotList(so.withholding);
  return {
    id: so.id,
    number: so.number,
    status: so.status,
    date: ymd(so.date)!,
    buyerPoNo: so.buyerPoNo,
    buyerPoDate: ymd(so.buyerPoDate),
    deliveryAddress: so.deliveryAddress,
    terms: so.terms,
    notes: so.notes,
    voidReason: so.voidReason,
    customer: so.customer,
    contact: so.contact,
    quote: so.quote,
    withholding,
    items: so.items.map((i) => itemView(i, withCosts)),
    totals: totalsView(so.items, withholding, withCosts),
    approval: await approvalFor(so.settingsVersionId, money(so.contractPrice), money(so.netMarginPct), withCosts),
    createdBy: so.createdBy.name,
    updatedBy: so.updatedBy.name,
    settingsVersionId: so.settingsVersionId,
    canSeeCosts: withCosts,
  };
}
export type SalesOrderView = NonNullable<Awaited<ReturnType<typeof getSalesOrderView>>>;

export const SALES_ORDER_STATUSES: SalesOrderStatus[] = ["OPEN", "VOID"];

export type SalesOrderListFilter = {
  q?: string;
  status?: SalesOrderStatus;
  /** Open SOs with at least one line still short of supplier PO coverage. */
  needsPo?: boolean;
};

export async function listSalesOrdersView(filter: SalesOrderListFilter) {
  const q = filter.q?.trim();
  const needsPo = filter.needsPo === true;
  const status = needsPo ? "OPEN" : filter.status;
  const where: Prisma.SalesOrderWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ number: { contains: q } }, { buyerPoNo: { contains: q } }, { customer: { name: { contains: q } } }] } : {}),
  };

  if (!needsPo) {
    const rows = await db.salesOrder.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      buyerPoNo: r.buyerPoNo,
      contractPrice: money(r.contractPrice),
      status: r.status,
      date: ymd(r.date)!,
    }));
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
  notes: string | null;
};

const printItem = (i: ItemRow): PrintItem => ({ description: i.description, qty: money(i.qty), unit: i.unit, unitPrice: money(i.unitPrice), total: money(i.total) });

async function companyFor(settingsVersionId: string) {
  const snap = (await getSettingsVersion(settingsVersionId)) ?? (await getSettingsSnapshot());
  return snap.settings.company;
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
    buyerPoNo: null,
    buyerPoDate: null,
    deliveryAddress: null,
    company: await companyFor(q.settingsVersionId),
    customer: { name: q.customer.name, address: await customerBlockAddress(q.customer), tin: q.customer.tin },
    contact: q.contact ? { name: q.contact.name, email: q.contact.email, phone: q.contact.phone } : null,
    items: q.items.map(printItem),
    contractPrice: money(q.contractPrice),
    terms: q.terms,
    notes: q.notes,
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
  supplierId?: string | null;
  supplierUnitCost?: string;
};

export function editableItems(items: ItemView[], withCosts: boolean): EditableItem[] {
  return items.map((i) => {
    const base = { id: i.id, description: i.description, kind: i.kind, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice };
    return withCosts ? { ...base, supplierId: i.supplierId ?? null, supplierUnitCost: i.supplierUnitCost ?? "0.00" } : base;
  });
}

export type { WithholdingSnapshot };
