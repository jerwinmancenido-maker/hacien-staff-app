// Transactions tab on customer and supplier pages: one list of documents for an
// owner, newest first, 50 per page, as a unified row type so supplier POs,
// invoices, bills and payments can plug in later as new `kind`s.
//
// Costs rule (same as src/lib/quotes/views.ts): supplier cost and margin keys are
// only set for users with "Can see costs", and the result also goes through
// stripCosts(). Which supplier is on a quote line is itself cost data (see
// COST_FIELDS: supplierId / supplierName), so a supplier's quote/SO lines are
// only listed for cost users; others get `restricted: true` and no rows.

import type { Prisma, PurchaseOrderStatus, QuoteStatus, ReceivingReportStatus, SalesOrderStatus, SupplierBillStatus } from "@prisma/client";
import { db } from "../db";
import { canSeeCosts, stripCosts, type PermissionUser } from "../permissions";
import { fromScaled, toScaled } from "../quotes/calc";
import { money, ymd } from "../documents/common";
import { QUOTE_STATUSES, SALES_ORDER_STATUSES } from "../quotes/views";
import { PO_STATUSES } from "../purchasing/status";
import type { ContactOwner } from "./contacts";

export type TransactionKind = "QUOTE" | "SALES_ORDER" | "PURCHASE_ORDER" | "RECEIVING_REPORT" | "SUPPLIER_BILL";
export const TRANSACTION_KINDS: TransactionKind[] = ["QUOTE", "SALES_ORDER", "PURCHASE_ORDER", "RECEIVING_REPORT", "SUPPLIER_BILL"];
export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  QUOTE: "Quote",
  SALES_ORDER: "Sales order",
  PURCHASE_ORDER: "Supplier PO",
  RECEIVING_REPORT: "Receiving report",
  SUPPLIER_BILL: "Supplier bill",
};
/** Purchasing kinds are cost data: only listed for users with "Can see costs". */
export const PURCHASING_KINDS: TransactionKind[] = ["PURCHASE_ORDER", "RECEIVING_REPORT", "SUPPLIER_BILL"];
export const RR_STATUSES: ReceivingReportStatus[] = ["POSTED", "VOID"];
export const BILL_STATUSES: SupplierBillStatus[] = ["RECORDED", "VOID"];
export { PO_STATUSES };

export const TRANSACTIONS_PAGE_SIZE = 50;

export type TransactionRow = {
  kind: TransactionKind;
  id: string;
  number: string;
  date: string;
  status: string;
  contactName: string | null;
  /**
   * Contract total (customer) or the total of this supplier's lines (supplier);
   * PO total, value received (qty × PO unit cost) or bill amount for purchasing kinds.
   */
  total: string;
  href: string;
  // Cost users only:
  supplierCost?: string;
  netMargin?: string;
  netMarginPct?: string;
};

export type TransactionTotals = {
  kind: TransactionKind;
  /** Documents counted in the totals (VOID excluded). */
  count: number;
  total: string;
  voidCount: number;
  // Cost users only:
  supplierCost?: string;
  netMargin?: string;
};

export type TransactionFilters = {
  contactId?: string | null;
  type?: TransactionKind | null;
  status?: string | null;
  page?: number;
};

export type TransactionList = {
  rows: TransactionRow[];
  totals: TransactionTotals[];
  page: number;
  pages: number;
  pageSize: number;
  totalRows: number;
  canSeeCosts: boolean;
  restricted: boolean;
};

const sumMoney = (values: readonly (string | { toFixed(n: number): string } | null | undefined)[]) =>
  fromScaled(
    values.reduce<bigint>((acc, v) => acc + (v == null ? 0n : toScaled(typeof v === "string" ? v : v.toFixed(2), 2)), 0n),
    2,
  );

/** Margin as % of the total, 2 dp (0 when the total is 0). */
function pctOf(margin: string, total: string): string {
  const t = toScaled(total, 2);
  if (t === 0n) return "0.00";
  const m = toScaled(margin, 2);
  // (m / t) × 100 with 2 decimals, rounded half away from zero.
  const num = m * 10000n;
  const neg = num < 0n !== t < 0n;
  const a = num < 0n ? -num : num;
  const b = t < 0n ? -t : t;
  const q = (a * 2n + b) / (b * 2n);
  return fromScaled(neg ? -q : q, 2);
}

function statusFilter<S extends string>(status: string | null | undefined, valid: readonly S[]): { status?: S } | null {
  if (!status) return {};
  return (valid as readonly string[]).includes(status) ? { status: status as S } : null;
}

function withoutCreatedAt(r: TransactionRow & { createdAt: Date }): TransactionRow {
  const out: Partial<TransactionRow & { createdAt: Date }> = { ...r };
  delete out.createdAt;
  return out as TransactionRow;
}

const newestFirst = (a: TransactionRow & { createdAt: Date }, b: TransactionRow & { createdAt: Date }) =>
  b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime() || b.number.localeCompare(a.number);

export async function listTransactions(owner: ContactOwner, filters: TransactionFilters, user: PermissionUser): Promise<TransactionList> {
  const withCosts = canSeeCosts(user);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const empty: TransactionList = { rows: [], totals: [], page: 1, pages: 1, pageSize: TRANSACTIONS_PAGE_SIZE, totalRows: 0, canSeeCosts: withCosts, restricted: false };
  if (owner.kind === "supplier" && !withCosts) return { ...empty, restricted: true };

  const qStatus = statusFilter<QuoteStatus>(filters.status, QUOTE_STATUSES);
  const soStatus = statusFilter<SalesOrderStatus>(filters.status, SALES_ORDER_STATUSES);
  const wantQuotes = (!filters.type || filters.type === "QUOTE") && qStatus !== null;
  const wantSos = (!filters.type || filters.type === "SALES_ORDER") && soStatus !== null;
  const contact = filters.contactId ? { contactId: filters.contactId } : {};

  const supplierId = owner.kind === "supplier" ? owner.id : null;
  const quoteOwner: Prisma.QuoteWhereInput = supplierId ? { items: { some: { supplierId, removedAt: null } } } : { customerId: owner.id };
  const soOwner: Prisma.SalesOrderWhereInput = supplierId ? { items: { some: { supplierId, removedAt: null } } } : { customerId: owner.id };
  const quoteWhere: Prisma.QuoteWhereInput = { ...quoteOwner, ...contact, ...(qStatus ?? {}) };
  const soWhere: Prisma.SalesOrderWhereInput = { ...soOwner, ...contact, ...(soStatus ?? {}) };

  // Page p of the merged list is within the first p × size rows of each list.
  const take = page * TRANSACTIONS_PAGE_SIZE;
  const orderBy = [{ date: "desc" }, { createdAt: "desc" }] as const;
  const supplierItems = supplierId ? { items: { where: { supplierId, removedAt: null }, select: { total: true, supplierTotal: true, margin: true } } } : {};

  const [quotes, sos, quoteCount, soCount] = await Promise.all([
    wantQuotes ? db.quote.findMany({ where: quoteWhere, orderBy: [...orderBy], take, include: { contact: { select: { name: true } }, ...supplierItems } }) : [],
    wantSos ? db.salesOrder.findMany({ where: soWhere, orderBy: [...orderBy], take, include: { contact: { select: { name: true } }, ...supplierItems } }) : [],
    wantQuotes ? db.quote.count({ where: quoteWhere }) : 0,
    wantSos ? db.salesOrder.count({ where: soWhere }) : 0,
  ]);

  const purchasing = withCosts ? await purchasingRows(owner, filters, take) : { rows: [], count: 0, totals: [] };

  type DocRow = (typeof quotes)[number] | (typeof sos)[number];
  const toRow = (kind: TransactionKind, d: DocRow): TransactionRow & { createdAt: Date } => {
    const lines = "items" in d ? (d.items as { total: unknown; supplierTotal: unknown; margin: unknown }[]) : null;
    const total = lines ? sumMoney(lines.map((l) => l.total as never)) : money(d.contractPrice);
    const base: TransactionRow & { createdAt: Date } = {
      kind,
      id: d.id,
      number: d.number,
      date: ymd(d.date)!,
      status: d.status,
      contactName: d.contact?.name ?? null,
      total,
      href: kind === "QUOTE" ? `/quotes/${d.id}` : `/sales-orders/${d.id}`,
      createdAt: d.createdAt,
    };
    if (!withCosts) return base;
    if (lines) {
      const cost = sumMoney(lines.map((l) => l.supplierTotal as never));
      const margin = sumMoney(lines.map((l) => l.margin as never));
      return { ...base, supplierCost: cost, netMargin: margin, netMarginPct: pctOf(margin, total) };
    }
    return { ...base, supplierCost: money(d.supplierCost), netMargin: money(d.netMargin), netMarginPct: money(d.netMarginPct) };
  };

  const merged = [...quotes.map((q) => toRow("QUOTE", q)), ...sos.map((s) => toRow("SALES_ORDER", s)), ...purchasing.rows].sort(newestFirst);
  const totalRows = quoteCount + soCount + purchasing.count;
  const rows = merged.slice((page - 1) * TRANSACTIONS_PAGE_SIZE, page * TRANSACTIONS_PAGE_SIZE).map(withoutCreatedAt);

  const totals: TransactionTotals[] = [];
  if (wantQuotes) totals.push(await kindTotals("QUOTE", quoteWhere, supplierId, withCosts));
  if (wantSos) totals.push(await kindTotals("SALES_ORDER", soWhere, supplierId, withCosts));
  totals.push(...purchasing.totals);

  return stripCosts(
    {
      rows,
      totals,
      page,
      pages: Math.max(1, Math.ceil(totalRows / TRANSACTIONS_PAGE_SIZE)),
      pageSize: TRANSACTIONS_PAGE_SIZE,
      totalRows,
      canSeeCosts: withCosts,
      restricted: false,
    },
    user,
  );
}

// ---------------------------------------------------------------------------
// Supplier POs, receiving reports and supplier bills (cost users only)
// ---------------------------------------------------------------------------

type Row = TransactionRow & { createdAt: Date };

/** qty (2 dp) × unit cost (2 dp) summed to cents. */
function valueReceived(items: readonly { qtyReceived: { toFixed(n: number): string }; purchaseOrderItem: { unitCost: { toFixed(n: number): string } } }[]): string {
  let cents = 0n;
  for (const i of items) {
    const p = toScaled(i.qtyReceived.toFixed(2), 2) * toScaled(i.purchaseOrderItem.unitCost.toFixed(2), 2);
    cents += (p + 50n) / 100n;
  }
  return fromScaled(cents, 2);
}

async function purchasingRows(owner: ContactOwner, filters: TransactionFilters, take: number): Promise<{ rows: Row[]; count: number; totals: TransactionTotals[] }> {
  const want = (k: TransactionKind) => !filters.type || filters.type === k;
  const poStatus = statusFilter<PurchaseOrderStatus>(filters.status, PO_STATUSES);
  const rrStatus = statusFilter<ReceivingReportStatus>(filters.status, RR_STATUSES);
  const billStatus = statusFilter<SupplierBillStatus>(filters.status, BILL_STATUSES);
  const supplier = owner.kind === "supplier";
  // Which POs belong to the owner (customers: through their sales orders), and the contact filter.
  const poOwner: Prisma.PurchaseOrderWhereInput = supplier ? { supplierId: owner.id } : { salesOrder: { is: { customerId: owner.id } } };
  const poContact: Prisma.PurchaseOrderWhereInput = filters.contactId ? (supplier ? { supplierContactId: filters.contactId } : { salesOrder: { is: { contactId: filters.contactId } } }) : {};
  const poScope: Prisma.PurchaseOrderWhereInput = { AND: [poOwner, poContact] };

  const poWhere: Prisma.PurchaseOrderWhereInput = { ...poScope, ...(poStatus ?? {}) };
  const rrWhere: Prisma.ReceivingReportWhereInput = { purchaseOrder: { is: poScope }, ...(rrStatus ?? {}) };
  const billWhere: Prisma.SupplierBillWhereInput = supplier
    ? { supplierId: owner.id, ...(filters.contactId ? { purchaseOrder: { is: { supplierContactId: filters.contactId } } } : {}), ...(billStatus ?? {}) }
    : { purchaseOrder: { is: poScope }, ...(billStatus ?? {}) };
  const wantPo = want("PURCHASE_ORDER") && poStatus !== null;
  const wantRr = want("RECEIVING_REPORT") && rrStatus !== null;
  const wantBill = want("SUPPLIER_BILL") && billStatus !== null;
  const orderBy = [{ createdAt: "desc" }] as const;

  const rrItems = { items: { select: { qtyReceived: true, purchaseOrderItem: { select: { unitCost: true } } } } } as const;
  const [pos, rrs, bills, poCount, rrCount, billCount] = await Promise.all([
    wantPo ? db.purchaseOrder.findMany({ where: poWhere, orderBy: [{ date: "desc" }, ...orderBy], take, include: { supplierContact: { select: { name: true } }, supplier: { select: { name: true } } } }) : [],
    wantRr
      ? db.receivingReport.findMany({
          where: rrWhere,
          orderBy: [{ receivedDate: "desc" }, ...orderBy],
          take,
          include: { ...rrItems, purchaseOrder: { select: { number: true, supplierContact: { select: { name: true } } } } },
        })
      : [],
    wantBill ? db.supplierBill.findMany({ where: billWhere, orderBy: [{ billDate: "desc" }, ...orderBy], take, include: { purchaseOrder: { select: { id: true, supplierContact: { select: { name: true } } } } } }) : [],
    wantPo ? db.purchaseOrder.count({ where: poWhere }) : 0,
    wantRr ? db.receivingReport.count({ where: rrWhere }) : 0,
    wantBill ? db.supplierBill.count({ where: billWhere }) : 0,
  ]);

  const rows: Row[] = [
    ...pos.map((p) => ({
      kind: "PURCHASE_ORDER" as const,
      id: p.id,
      number: p.number,
      date: ymd(p.date)!,
      status: p.status,
      contactName: supplier ? (p.supplierContact?.name ?? null) : p.supplier.name,
      total: money(p.subtotal),
      href: `/purchase-orders/${p.id}`,
      createdAt: p.createdAt,
    })),
    ...rrs.map((r) => ({
      kind: "RECEIVING_REPORT" as const,
      id: r.id,
      number: r.number,
      date: ymd(r.receivedDate)!,
      status: r.status,
      contactName: r.purchaseOrder.supplierContact?.name ?? null,
      total: valueReceived(r.items),
      href: `/purchase-orders/${r.purchaseOrderId}?tab=receiving`,
      createdAt: r.createdAt,
    })),
    ...bills.map((b) => ({
      kind: "SUPPLIER_BILL" as const,
      id: b.id,
      number: b.billNumber,
      date: ymd(b.billDate)!,
      status: b.status,
      contactName: b.purchaseOrder?.supplierContact?.name ?? null,
      total: money(b.amount),
      href: b.purchaseOrder ? `/purchase-orders/${b.purchaseOrder.id}?tab=bills` : `/suppliers/${b.supplierId}?tab=transactions`,
      createdAt: b.createdAt,
    })),
  ];

  const totals: TransactionTotals[] = [];
  if (wantPo) {
    const notVoid = { AND: [poWhere, { status: { not: "VOID" as const } }] };
    const [count, voidCount, sum] = await Promise.all([
      db.purchaseOrder.count({ where: notVoid }),
      db.purchaseOrder.count({ where: { AND: [poWhere, { status: "VOID" }] } }),
      db.purchaseOrder.aggregate({ where: notVoid, _sum: { subtotal: true } }),
    ]);
    totals.push({ kind: "PURCHASE_ORDER", count, voidCount, total: sumMoney([sum._sum.subtotal]) });
  }
  if (wantRr) {
    const notVoid = { AND: [rrWhere, { status: "POSTED" as const }] };
    const [posted, voidCount] = await Promise.all([
      db.receivingReport.findMany({ where: notVoid, select: rrItems }),
      db.receivingReport.count({ where: { AND: [rrWhere, { status: "VOID" }] } }),
    ]);
    totals.push({ kind: "RECEIVING_REPORT", count: posted.length, voidCount, total: valueReceived(posted.flatMap((r) => r.items)) });
  }
  if (wantBill) {
    const notVoid = { AND: [billWhere, { status: "RECORDED" as const }] };
    const [count, voidCount, sum] = await Promise.all([
      db.supplierBill.count({ where: notVoid }),
      db.supplierBill.count({ where: { AND: [billWhere, { status: "VOID" }] } }),
      db.supplierBill.aggregate({ where: notVoid, _sum: { amount: true } }),
    ]);
    totals.push({ kind: "SUPPLIER_BILL", count, voidCount, total: sumMoney([sum._sum.amount]) });
  }
  return { rows, count: poCount + rrCount + billCount, totals };
}

/** Totals for one kind over the whole filtered set (not just the page). VOID documents are only counted. */
async function kindTotals(
  kind: TransactionKind,
  where: Prisma.QuoteWhereInput | Prisma.SalesOrderWhereInput,
  supplierId: string | null,
  withCosts: boolean,
): Promise<TransactionTotals> {
  const notVoid = { AND: [where, { status: { not: "VOID" as const } }] };
  const isVoid = { AND: [where, { status: "VOID" as const }] };
  let count: number;
  let voidCount: number;
  let sums: { total: unknown; cost: unknown; margin: unknown };
  if (kind === "QUOTE") {
    [count, voidCount] = await Promise.all([db.quote.count({ where: notVoid as Prisma.QuoteWhereInput }), db.quote.count({ where: isVoid as Prisma.QuoteWhereInput })]);
    if (supplierId) {
      const s = await db.quoteItem.aggregate({
        where: { supplierId, removedAt: null, quote: { is: notVoid as Prisma.QuoteWhereInput } },
        _sum: { total: true, supplierTotal: true, margin: true },
      });
      sums = { total: s._sum.total, cost: s._sum.supplierTotal, margin: s._sum.margin };
    } else {
      const s = await db.quote.aggregate({ where: notVoid as Prisma.QuoteWhereInput, _sum: { contractPrice: true, supplierCost: true, netMargin: true } });
      sums = { total: s._sum.contractPrice, cost: s._sum.supplierCost, margin: s._sum.netMargin };
    }
  } else {
    [count, voidCount] = await Promise.all([
      db.salesOrder.count({ where: notVoid as Prisma.SalesOrderWhereInput }),
      db.salesOrder.count({ where: isVoid as Prisma.SalesOrderWhereInput }),
    ]);
    if (supplierId) {
      const s = await db.salesOrderItem.aggregate({
        where: { supplierId, removedAt: null, salesOrder: { is: notVoid as Prisma.SalesOrderWhereInput } },
        _sum: { total: true, supplierTotal: true, margin: true },
      });
      sums = { total: s._sum.total, cost: s._sum.supplierTotal, margin: s._sum.margin };
    } else {
      const s = await db.salesOrder.aggregate({ where: notVoid as Prisma.SalesOrderWhereInput, _sum: { contractPrice: true, supplierCost: true, netMargin: true } });
      sums = { total: s._sum.contractPrice, cost: s._sum.supplierCost, margin: s._sum.netMargin };
    }
  }
  const total = sumMoney([sums.total as never]);
  const base: TransactionTotals = { kind, count, total, voidCount };
  return withCosts ? { ...base, supplierCost: sumMoney([sums.cost as never]), netMargin: sumMoney([sums.margin as never]) } : base;
}

/** Overview stat cards: open quotes (Draft/Sent) and open sales orders, with their contract totals. */
export async function openDocumentStats(owner: ContactOwner, user: PermissionUser) {
  if (owner.kind === "supplier" && !canSeeCosts(user)) return null;
  const quoteOwner: Prisma.QuoteWhereInput =
    owner.kind === "supplier" ? { items: { some: { supplierId: owner.id, removedAt: null } } } : { customerId: owner.id };
  const soOwner: Prisma.SalesOrderWhereInput =
    owner.kind === "supplier" ? { items: { some: { supplierId: owner.id, removedAt: null } } } : { customerId: owner.id };
  const [q, so, lastQuote, lastSo] = await Promise.all([
    db.quote.aggregate({ where: { ...quoteOwner, status: { in: ["DRAFT", "SENT"] } }, _count: true, _sum: { contractPrice: true } }),
    db.salesOrder.aggregate({ where: { ...soOwner, status: "OPEN" }, _count: true, _sum: { contractPrice: true } }),
    db.quote.findFirst({ where: quoteOwner, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    db.salesOrder.findFirst({ where: soOwner, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  const poStats =
    owner.kind === "supplier" && canSeeCosts(user)
      ? await Promise.all([
          db.purchaseOrder.count({ where: { supplierId: owner.id, status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } } }),
          db.purchaseOrder.count({ where: { supplierId: owner.id, status: { in: ["SENT", "PARTIALLY_RECEIVED"] } } }),
        ])
      : null;
  const lastDocAt = [lastQuote?.updatedAt, lastSo?.updatedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    openQuotes: q._count,
    openQuotesTotal: sumMoney([q._sum.contractPrice]),
    openSalesOrders: so._count,
    openSalesOrdersTotal: sumMoney([so._sum.contractPrice]),
    ...(poStats ? { openPos: poStats[0], awaitingReceipt: poStats[1] } : {}),
    lastDocAt,
  };
}

export const __test = { sumMoney, pctOf };
