// Transactions tab on customer and supplier pages: one list of documents for an
// owner, newest first, 50 per page, as a unified row type so supplier POs,
// invoices, bills and payments can plug in later as new `kind`s.
//
// Costs rule (same as src/lib/quotes/views.ts): supplier cost and margin keys are
// only set for users with "Can see costs", and the result also goes through
// stripCosts(). Which supplier is on a quote line is itself cost data (see
// COST_FIELDS: supplierId / supplierName), so a supplier's quote/SO lines are
// only listed for cost users; others get `restricted: true` and no rows.

import type {
  BillingStatus,
  CollectionStatus,
  Prisma,
  PurchaseOrderStatus,
  QuoteStatus,
  ReceivingReportStatus,
  SalesOrderStatus,
  SupplierBillStatus,
  SupplierPaymentStatus,
} from "@prisma/client";
import { db } from "../db";
import { canSeeCosts, stripCosts, type PermissionUser } from "../permissions";
import { fromScaled, toScaled } from "../quotes/calc";
import { money, ymd } from "../documents/common";
import { QUOTE_STATUSES, SALES_ORDER_STATUSES } from "../quotes/views";
import { PO_STATUSES } from "../purchasing/status";
import { billingBalance } from "../billing/status";
import { overdueInfo } from "../billing/views";
import { getSettingsSnapshot } from "../settings";
import type { ContactOwner } from "./contacts";

export type TransactionKind =
  | "QUOTE"
  | "SALES_ORDER"
  | "PURCHASE_ORDER"
  | "RECEIVING_REPORT"
  | "SUPPLIER_BILL"
  | "BILLING"
  | "COLLECTION"
  | "SUPPLIER_PAYMENT";
export const TRANSACTION_KINDS: TransactionKind[] = [
  "QUOTE",
  "SALES_ORDER",
  "PURCHASE_ORDER",
  "RECEIVING_REPORT",
  "SUPPLIER_BILL",
  "BILLING",
  "COLLECTION",
  "SUPPLIER_PAYMENT",
];
export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  QUOTE: "Quote",
  SALES_ORDER: "Sales order",
  PURCHASE_ORDER: "Supplier PO",
  RECEIVING_REPORT: "Receiving report",
  SUPPLIER_BILL: "Supplier bill",
  BILLING: "Billing",
  COLLECTION: "Collection",
  SUPPLIER_PAYMENT: "Supplier payment",
};
/** Purchasing kinds are cost data: only listed for users with "Can see costs". */
export const PURCHASING_KINDS: TransactionKind[] = ["PURCHASE_ORDER", "RECEIVING_REPORT", "SUPPLIER_BILL", "SUPPLIER_PAYMENT"];
/** Customer-facing billing kinds (not cost data). */
export const BILLING_KINDS: TransactionKind[] = ["BILLING", "COLLECTION"];
/** Customer Transactions tab: quotes, SOs, billings, collections only. */
export const CUSTOMER_TX_KINDS: TransactionKind[] = ["QUOTE", "SALES_ORDER", ...BILLING_KINDS];
/** Supplier Transactions tab: POs, RRs, supplier bills and supplier payments. */
export const SUPPLIER_TX_KINDS: TransactionKind[] = [...PURCHASING_KINDS];
export const RR_STATUSES: ReceivingReportStatus[] = ["POSTED", "VOID"];
export const BILL_STATUSES: SupplierBillStatus[] = ["RECORDED", "PARTIALLY_PAID", "PAID", "VOID"];
export const BILLING_TX_STATUSES: BillingStatus[] = ["OPEN", "PARTIALLY_PAID", "PAID", "VOID"];
export const COLLECTION_TX_STATUSES: CollectionStatus[] = ["POSTED", "VOID"];
export const SUPPLIER_PAYMENT_TX_STATUSES: SupplierPaymentStatus[] = ["POSTED", "VOID"];
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
  // Supplier Transactions are cost data (POs / RRs / bills [/ payments]).
  if (owner.kind === "supplier" && !withCosts) return { ...empty, restricted: true };

  // Page p of the merged list is within the first p × size rows of each list.
  const take = page * TRANSACTIONS_PAGE_SIZE;

  // Bidirectional separation for every role:
  // - customer → quotes, SOs, billings, collections only
  // - supplier → POs, RRs, supplier bills (payments on later stack) only
  if (owner.kind === "supplier") {
    const purchasing = await purchasingRows(owner, filters, take);
    const merged = [...purchasing.rows].sort(newestFirst);
    const rows = merged.slice((page - 1) * TRANSACTIONS_PAGE_SIZE, page * TRANSACTIONS_PAGE_SIZE).map(withoutCreatedAt);
    return stripCosts(
      {
        rows,
        totals: purchasing.totals,
        page,
        pages: Math.max(1, Math.ceil(purchasing.count / TRANSACTIONS_PAGE_SIZE)),
        pageSize: TRANSACTIONS_PAGE_SIZE,
        totalRows: purchasing.count,
        canSeeCosts: withCosts,
        restricted: false,
      },
      user,
    );
  }

  const qStatus = statusFilter<QuoteStatus>(filters.status, QUOTE_STATUSES);
  const soStatus = statusFilter<SalesOrderStatus>(filters.status, SALES_ORDER_STATUSES);
  const wantQuotes = (!filters.type || filters.type === "QUOTE") && qStatus !== null;
  const wantSos = (!filters.type || filters.type === "SALES_ORDER") && soStatus !== null;
  const contact = filters.contactId ? { contactId: filters.contactId } : {};

  const quoteWhere: Prisma.QuoteWhereInput = { customerId: owner.id, ...contact, ...(qStatus ?? {}) };
  const soWhere: Prisma.SalesOrderWhereInput = { customerId: owner.id, ...contact, ...(soStatus ?? {}) };
  const orderBy = [{ date: "desc" }, { createdAt: "desc" }] as const;

  const [quotes, sos, quoteCount, soCount] = await Promise.all([
    wantQuotes ? db.quote.findMany({ where: quoteWhere, orderBy: [...orderBy], take, include: { contact: { select: { name: true } } } }) : [],
    wantSos ? db.salesOrder.findMany({ where: soWhere, orderBy: [...orderBy], take, include: { contact: { select: { name: true } } } }) : [],
    wantQuotes ? db.quote.count({ where: quoteWhere }) : 0,
    wantSos ? db.salesOrder.count({ where: soWhere }) : 0,
  ]);

  const billing = await billingRows(owner.id, filters, take);

  type DocRow = (typeof quotes)[number] | (typeof sos)[number];
  const toRow = (kind: TransactionKind, d: DocRow): TransactionRow & { createdAt: Date } => {
    const total = money(d.contractPrice);
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
    return { ...base, supplierCost: money(d.supplierCost), netMargin: money(d.netMargin), netMarginPct: money(d.netMarginPct) };
  };

  const merged = [...quotes.map((q) => toRow("QUOTE", q)), ...sos.map((s) => toRow("SALES_ORDER", s)), ...billing.rows].sort(newestFirst);
  const totalRows = quoteCount + soCount + billing.count;
  const rows = merged.slice((page - 1) * TRANSACTIONS_PAGE_SIZE, page * TRANSACTIONS_PAGE_SIZE).map(withoutCreatedAt);

  const totals: TransactionTotals[] = [];
  if (wantQuotes) totals.push(await kindTotals("QUOTE", quoteWhere, null, withCosts));
  if (wantSos) totals.push(await kindTotals("SALES_ORDER", soWhere, null, withCosts));
  totals.push(...billing.totals);

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
// Customer billings & collections (not cost data; shown to all roles with view)
// ---------------------------------------------------------------------------

type Row = TransactionRow & { createdAt: Date };

async function billingRows(customerId: string, filters: TransactionFilters, take: number): Promise<{ rows: Row[]; count: number; totals: TransactionTotals[] }> {
  const want = (k: TransactionKind) => !filters.type || filters.type === k;
  // Contact filter: billings/collections aren't tied to a contact; skip when a contact is selected.
  if (filters.contactId) return { rows: [], count: 0, totals: [] };
  const bStatus = statusFilter<BillingStatus>(filters.status, BILLING_TX_STATUSES);
  const cStatus = statusFilter<CollectionStatus>(filters.status, COLLECTION_TX_STATUSES);
  const wantBilling = want("BILLING") && bStatus !== null;
  const wantCollection = want("COLLECTION") && cStatus !== null;
  const orderBy = [{ createdAt: "desc" }] as const;

  const billingWhere: Prisma.BillingWhereInput = { customerId, ...(bStatus ?? {}) };
  const collectionWhere: Prisma.CollectionWhereInput = { customerId, ...(cStatus ?? {}) };

  const [billings, collections, billingCount, collectionCount] = await Promise.all([
    wantBilling
      ? db.billing.findMany({
          where: billingWhere,
          orderBy: [{ invoiceDate: "desc" }, ...orderBy],
          take,
          include: { allocations: { where: { collection: { status: "POSTED" } } }, salesOrder: { select: { contact: { select: { name: true } } } } },
        })
      : [],
    wantCollection
      ? db.collection.findMany({ where: collectionWhere, orderBy: [{ date: "desc" }, ...orderBy], take })
      : [],
    wantBilling ? db.billing.count({ where: billingWhere }) : 0,
    wantCollection ? db.collection.count({ where: collectionWhere }) : 0,
  ]);

  const snap = await getSettingsSnapshot();
  const grace = snap.settings.collections.overdueGraceDays;

  const rows: Row[] = [
    ...billings.map((b) => {
      const cash = b.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
      const wh = b.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n);
      const balance = billingBalance(money(b.amount), { cashApplied: fromScaled(cash, 2), withholdingApplied: fromScaled(wh, 2) });
      const od = overdueInfo(b.dueDate, balance, grace);
      const status = od.overdue && b.status !== "VOID" && b.status !== "PAID" ? `${b.status}|OVERDUE` : b.status;
      return {
        kind: "BILLING" as const,
        id: b.id,
        number: `Inv ${b.invoiceNo} · ${b.number}`,
        date: ymd(b.invoiceDate)!,
        status,
        contactName: b.salesOrder.contact?.name ?? null,
        total: balance,
        href: `/billing/billings/${b.id}`,
        createdAt: b.createdAt,
      };
    }),
    ...collections.map((c) => ({
      kind: "COLLECTION" as const,
      id: c.id,
      number: c.receiptNo ? `${c.number} · ${c.receiptNo}` : c.number,
      date: ymd(c.date)!,
      status: c.status,
      contactName: null,
      total: money(c.amountReceived),
      href: `/billing/collections/${c.id}`,
      createdAt: c.createdAt,
    })),
  ];

  const totals: TransactionTotals[] = [];
  if (wantBilling) {
    const notVoid = { AND: [billingWhere, { status: { not: "VOID" as const } }] };
    const [count, voidCount, sum] = await Promise.all([
      db.billing.count({ where: notVoid }),
      db.billing.count({ where: { AND: [billingWhere, { status: "VOID" }] } }),
      db.billing.aggregate({ where: notVoid, _sum: { amount: true } }),
    ]);
    totals.push({ kind: "BILLING", count, voidCount, total: sumMoney([sum._sum.amount]) });
  }
  if (wantCollection) {
    const notVoid = { AND: [collectionWhere, { status: "POSTED" as const }] };
    const [count, voidCount, sum] = await Promise.all([
      db.collection.count({ where: notVoid }),
      db.collection.count({ where: { AND: [collectionWhere, { status: "VOID" }] } }),
      db.collection.aggregate({ where: notVoid, _sum: { amountReceived: true } }),
    ]);
    totals.push({ kind: "COLLECTION", count, voidCount, total: sumMoney([sum._sum.amountReceived]) });
  }
  return { rows, count: billingCount + collectionCount, totals };
}

// ---------------------------------------------------------------------------
// Supplier POs, receiving reports and supplier bills (cost users only)
// ---------------------------------------------------------------------------


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
  const payStatus = statusFilter<SupplierPaymentStatus>(filters.status, SUPPLIER_PAYMENT_TX_STATUSES);
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
  const payWhere: Prisma.SupplierPaymentWhereInput = supplier
    ? { supplierId: owner.id, ...(payStatus ?? {}) }
    : { allocations: { some: { supplierBill: { is: { purchaseOrder: { is: poScope } } } } }, ...(payStatus ?? {}) };
  const wantPo = want("PURCHASE_ORDER") && poStatus !== null;
  const wantRr = want("RECEIVING_REPORT") && rrStatus !== null;
  const wantBill = want("SUPPLIER_BILL") && billStatus !== null;
  // Payments are supplier-scoped; skip when filtering a customer with a contact.
  const wantPay = want("SUPPLIER_PAYMENT") && payStatus !== null && !(owner.kind === "customer" && filters.contactId);
  const orderBy = [{ createdAt: "desc" }] as const;

  const rrItems = { items: { select: { qtyReceived: true, purchaseOrderItem: { select: { unitCost: true } } } } } as const;
  const [pos, rrs, bills, pays, poCount, rrCount, billCount, payCount] = await Promise.all([
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
    wantPay ? db.supplierPayment.findMany({ where: payWhere, orderBy: [{ date: "desc" }, ...orderBy], take, include: { supplier: { select: { name: true } } } }) : [],
    wantPo ? db.purchaseOrder.count({ where: poWhere }) : 0,
    wantRr ? db.receivingReport.count({ where: rrWhere }) : 0,
    wantBill ? db.supplierBill.count({ where: billWhere }) : 0,
    wantPay ? db.supplierPayment.count({ where: payWhere }) : 0,
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
    ...pays.map((p) => ({
      kind: "SUPPLIER_PAYMENT" as const,
      id: p.id,
      number: p.number,
      date: ymd(p.date)!,
      status: p.status,
      contactName: supplier ? null : p.supplier.name,
      total: money(p.amountPaid),
      href: `/payables/payments/${p.id}`,
      createdAt: p.createdAt,
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
    const notVoid = { AND: [billWhere, { status: { not: "VOID" as const } }] };
    const [count, voidCount, sum] = await Promise.all([
      db.supplierBill.count({ where: notVoid }),
      db.supplierBill.count({ where: { AND: [billWhere, { status: "VOID" }] } }),
      db.supplierBill.aggregate({ where: notVoid, _sum: { amount: true } }),
    ]);
    totals.push({ kind: "SUPPLIER_BILL", count, voidCount, total: sumMoney([sum._sum.amount]) });
  }
  if (wantPay) {
    const notVoid = { AND: [payWhere, { status: "POSTED" as const }] };
    const [count, voidCount, sum] = await Promise.all([
      db.supplierPayment.count({ where: notVoid }),
      db.supplierPayment.count({ where: { AND: [payWhere, { status: "VOID" }] } }),
      db.supplierPayment.aggregate({ where: notVoid, _sum: { amountPaid: true } }),
    ]);
    totals.push({ kind: "SUPPLIER_PAYMENT", count, voidCount, total: sumMoney([sum._sum.amountPaid]) });
  }
  return { rows, count: poCount + rrCount + billCount + payCount, totals };
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
