// Read models for billing pages, AR aging, overdue badges, and statements.

import type { BillingStatus, CollectionMethod, CollectionStatus, Withholding2307Status } from "@prisma/client";
import { db } from "../db";
import { money, ymd } from "../documents/common";
import { formatAddress } from "../addresses/format";
import { fromScaled, toScaled } from "../quotes/calc";
import { getSettingsSnapshot } from "../settings";
import { agingBucket, emptyAging, sumAging, type AgingAmounts, type AgingBucket } from "./aging";
import { bookletGrid } from "./booklet";
import { billingToday, daysPastDue, isOverdue } from "./dates";
import { billingBalance, openingCreditAsOf, unappliedCash } from "./status";
import { customerCreditBalance } from "../services/collections";
import { getNonVatMeter } from "../services/non-vat";

export const BILLING_STATUSES: BillingStatus[] = ["OPEN", "PARTIALLY_PAID", "PAID", "VOID"];
export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  OPEN: "Open",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  VOID: "Void",
};

export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
  POSTED: "Posted",
  VOID: "Void",
};

export type OverdueInfo = { overdue: boolean; days: number; label: string | null };

export function overdueInfo(dueDate: Date, balance: string, graceDays: number, today = billingToday()): OverdueInfo {
  const days = daysPastDue(dueDate, today, graceDays);
  const overdue = isOverdue(dueDate, balance, today, graceDays);
  return { overdue, days, label: overdue ? `Overdue ${days} day${days === 1 ? "" : "s"}` : null };
}

function appliedOf(allocs: { cashApplied: unknown; withholdingApplied: unknown }[]) {
  const cash = allocs.reduce((a, x) => a + toScaled(money(x.cashApplied as never), 2), 0n);
  const wh = allocs.reduce((a, x) => a + toScaled(money(x.withholdingApplied as never), 2), 0n);
  return { cashApplied: fromScaled(cash, 2), withholdingApplied: fromScaled(wh, 2) };
}

type BillingListFilters = {
  customerId?: string;
  salesOrderId?: string;
  status?: BillingStatus | "ALL" | "OVERDUE";
  q?: string;
  /** Inclusive Manila YYYY-MM-DD bounds on invoiceDate (DATE column). */
  fromYmd?: string;
  toYmd?: string;
};

/** Shared where-clause for list + uncapped sum (list pages still page with take:200). */
function billingsWhere(filters: BillingListFilters) {
  const where: {
    customerId?: string;
    salesOrderId?: string;
    status?: BillingStatus | { not: "VOID" };
    invoiceDate?: { gte?: Date; lte?: Date };
    OR?: ({ number: { contains: string } } | { customer: { name: { contains: string } } } | { invoiceNo: number })[];
  } = {};
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;
  if (filters.status && filters.status !== "ALL" && filters.status !== "OVERDUE") where.status = filters.status;
  if (filters.fromYmd || filters.toYmd) {
    where.invoiceDate = {
      ...(filters.fromYmd ? { gte: new Date(`${filters.fromYmd}T00:00:00.000Z`) } : {}),
      ...(filters.toYmd ? { lte: new Date(`${filters.toYmd}T00:00:00.000Z`) } : {}),
    };
    // Month / range views skip voids so totals match "billed this month".
    if (!filters.status || filters.status === "ALL") where.status = { not: "VOID" };
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const asNo = Number(q);
    where.OR = [
      { number: { contains: q } },
      { customer: { name: { contains: q } } },
      ...(Number.isInteger(asNo) ? [{ invoiceNo: asNo }] : []),
    ];
  }
  return where;
}

/**
 * Uncapped Σ(amount) with the same filters as listBillings (voids excluded on
 * month/range views). Home money must use this — listBillings is take:200.
 */
export async function sumBillingsAmount(filters: BillingListFilters = {}): Promise<string> {
  if (filters.status === "OVERDUE") {
    throw new Error("sumBillingsAmount does not support OVERDUE; use arAgingSummary().overdueCount / overdue.");
  }
  const agg = await db.billing.aggregate({ where: billingsWhere(filters), _sum: { amount: true } });
  return money(agg._sum.amount ?? 0);
}

export async function listBillings(filters: BillingListFilters = {}) {
  const snap = await getSettingsSnapshot();
  const grace = snap.settings.collections.overdueGraceDays;
  const today = billingToday();
  const overdueOnly = filters.status === "OVERDUE";
  const where = billingsWhere(filters);
  // OVERDUE: exclude voids up front; filter overdue before take:200 so recent
  // current invoices cannot crowd overdue rows off the page.
  if (overdueOnly) where.status = { not: "VOID" };

  const rows = await db.billing.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      salesOrder: { select: { id: true, number: true } },
      allocations: { where: { collection: { status: "POSTED" } } },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    // Page after overdue filter (below). Other statuses keep the DB take.
    ...(overdueOnly ? {} : { take: 200 }),
  });
  const mapped = rows.map((b) => {
    const applied = appliedOf(b.allocations);
    const balance = billingBalance(money(b.amount), applied);
    const od = overdueInfo(b.dueDate, balance, grace, today);
    return {
      id: b.id,
      number: b.number,
      invoiceNo: b.invoiceNo,
      invoiceDate: ymd(b.invoiceDate)!,
      dueDate: ymd(b.dueDate)!,
      amount: money(b.amount),
      balance,
      status: b.status,
      customer: b.customer,
      salesOrder: b.salesOrder,
      overdue: od,
      aging: agingBucket(b.dueDate, today) as AgingBucket,
    };
  });
  if (overdueOnly) return mapped.filter((r) => r.overdue.overdue).slice(0, 200);
  return mapped;
}

export async function getBillingView(id: string) {
  const snap = await getSettingsSnapshot();
  const grace = snap.settings.collections.overdueGraceDays;
  const b = await db.billing.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, tin: true } },
      salesOrder: { select: { id: true, number: true, terms: true, contractPrice: true, status: true } },
      allocations: {
        where: { collection: { status: "POSTED" } },
        include: { collection: { select: { id: true, number: true, date: true, method: true, receiptNo: true, status: true } } },
      },
      attachments: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      withholdings: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!b) return null;
  const applied = appliedOf(b.allocations);
  const balance = billingBalance(money(b.amount), applied);
  const od = overdueInfo(b.dueDate, balance, grace);
  return {
    id: b.id,
    number: b.number,
    invoiceNo: b.invoiceNo,
    invoiceDate: ymd(b.invoiceDate)!,
    dueDate: ymd(b.dueDate)!,
    amount: money(b.amount),
    withholdingExpected: money(b.withholdingExpected),
    netExpected: money(b.netExpected),
    status: b.status,
    notes: b.notes,
    voidReason: b.voidReason,
    voidedAt: b.voidedAt,
    customer: b.customer,
    salesOrder: { ...b.salesOrder, contractPrice: money(b.salesOrder.contractPrice) },
    balance,
    applied,
    overdue: od,
    allocations: b.allocations.map((a) => ({
      id: a.id,
      cashApplied: money(a.cashApplied),
      withholdingApplied: money(a.withholdingApplied),
      collection: {
        ...a.collection,
        date: ymd(a.collection.date)!,
      },
    })),
    attachments: b.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      href: `/files/attachments/${a.id}`,
    })),
    withholdings: b.withholdings.map((w) => ({
      id: w.id,
      amount: money(w.amount),
      rate: String(w.rate),
      atcCode: w.atcCode,
      status: w.status as Withholding2307Status,
      receivedAt: ymd(w.receivedAt),
    })),
  };
}

type CollectionListFilters = {
  customerId?: string;
  status?: CollectionStatus | "ALL";
  q?: string;
  /** Inclusive Manila YYYY-MM-DD bounds on collection date (DATE column). */
  fromYmd?: string;
  toYmd?: string;
};

/** Shared where-clause for list + uncapped sum (list pages still page with take:200). */
function collectionsWhere(filters: CollectionListFilters) {
  const where: {
    customerId?: string;
    status?: CollectionStatus;
    date?: { gte?: Date; lte?: Date };
    OR?: ({ number: { contains: string } } | { receiptNo: { contains: string } } | { customer: { name: { contains: string } } } | { reference: { contains: string } })[];
  } = {};
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  if (filters.fromYmd || filters.toYmd) {
    where.date = {
      ...(filters.fromYmd ? { gte: new Date(`${filters.fromYmd}T00:00:00.000Z`) } : {}),
      ...(filters.toYmd ? { lte: new Date(`${filters.toYmd}T00:00:00.000Z`) } : {}),
    };
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [{ number: { contains: q } }, { receiptNo: { contains: q } }, { customer: { name: { contains: q } } }, { reference: { contains: q } }];
  }
  return where;
}

/**
 * Uncapped Σ(amountReceived) with the same filters as listCollections.
 * Home money must use this — listCollections is take:200.
 */
export async function sumCollectionsReceived(filters: CollectionListFilters = {}): Promise<string> {
  const agg = await db.collection.aggregate({
    where: collectionsWhere(filters),
    _sum: { amountReceived: true },
  });
  return money(agg._sum.amountReceived ?? 0);
}

export async function listCollections(filters: CollectionListFilters = {}) {
  const where = collectionsWhere(filters);
  const rows = await db.collection.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      cashAccount: { select: { id: true, name: true } },
      allocations: true,
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map((c) => {
    const cashApplied = fromScaled(
      c.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n),
      2,
    );
    const credit = unappliedCash(money(c.amountReceived), c.allocations.map((a) => money(a.cashApplied)));
    return {
      id: c.id,
      number: c.number,
      date: ymd(c.date)!,
      method: c.method as CollectionMethod,
      receiptNo: c.receiptNo,
      amountReceived: money(c.amountReceived),
      cashAccount: c.cashAccount,
      cashApplied,
      unappliedCredit: credit,
      status: c.status,
      customer: c.customer,
    };
  });
}

export async function getCollectionView(id: string) {
  const c = await db.collection.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, tin: true } },
      cashAccount: { select: { id: true, name: true } },
      allocations: {
        include: {
          billing: { select: { id: true, number: true, invoiceNo: true, amount: true, dueDate: true, status: true } },
        },
      },
      attachments: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      withholdings: true,
    },
  });
  if (!c) return null;
  const cashApplied = fromScaled(
    c.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n),
    2,
  );
  return {
    id: c.id,
    number: c.number,
    date: ymd(c.date)!,
    method: c.method,
    reference: c.reference,
    checkBank: c.checkBank,
    checkDate: ymd(c.checkDate),
    receiptNo: c.receiptNo,
    amountReceived: money(c.amountReceived),
    cashAccount: c.cashAccount,
    cashApplied,
    unappliedCredit: unappliedCash(money(c.amountReceived), c.allocations.map((a) => money(a.cashApplied))),
    notes: c.notes,
    status: c.status,
    voidReason: c.voidReason,
    customer: c.customer,
    allocations: c.allocations.map((a) => ({
      id: a.id,
      cashApplied: money(a.cashApplied),
      withholdingApplied: money(a.withholdingApplied),
      billing: {
        ...a.billing,
        amount: money(a.billing.amount),
        dueDate: ymd(a.billing.dueDate)!,
      },
    })),
    attachments: c.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      href: `/files/attachments/${a.id}`,
    })),
    withholdings: c.withholdings.map((w) => ({
      id: w.id,
      amount: money(w.amount),
      rate: String(w.rate),
      atcCode: w.atcCode,
      status: w.status,
      billingId: w.billingId,
    })),
  };
}

export type CustomerAgingRow = {
  customerId: string;
  customerName: string;
  aging: AgingAmounts;
  overdue: string;
  credit: string;
};

/**
 * Unapplied customer credit for every customer with POSTED collections, in one
 * pass (same math as customerCreditBalance per id).
 */
async function customerCreditsGrouped(): Promise<Map<string, { name: string; credit: string }>> {
  const collections = await db.collection.findMany({
    where: { status: "POSTED" },
    select: {
      customerId: true,
      amountReceived: true,
      allocations: { select: { cashApplied: true } },
      customer: { select: { name: true } },
    },
  });
  const scaled = new Map<string, { name: string; credit: bigint }>();
  for (const c of collections) {
    const unapplied = unappliedCash(
      money(c.amountReceived),
      c.allocations.map((a) => money(a.cashApplied)),
    );
    const cur = scaled.get(c.customerId) ?? { name: c.customer.name, credit: 0n };
    cur.credit += toScaled(unapplied, 2);
    scaled.set(c.customerId, cur);
  }
  const out = new Map<string, { name: string; credit: string }>();
  for (const [id, v] of scaled) out.set(id, { name: v.name, credit: fromScaled(v.credit, 2) });
  return out;
}

/**
 * Count of billings that expect a customer 2307 and do not have one recorded yet
 * (posted collection with amount > 0). Same number on Home and /billing/2307.
 */
export async function countPending2307Expected(): Promise<number> {
  const billings = await db.billing.findMany({
    where: {
      status: { not: "VOID" },
      withholdingExpected: { gt: 0 },
    },
    select: {
      id: true,
      withholdings: {
        where: { amount: { gt: 0 }, collection: { status: "POSTED" } },
        select: { id: true },
        take: 1,
      },
    },
  });
  return billings.filter((b) => b.withholdings.length === 0).length;
}

export async function arAgingSummary(): Promise<{
  totalReceivable: string;
  overdue: string;
  /** Count of non-void billings with balance > 0 that are past due (grace applied). */
  overdueCount: number;
  /** Count of non-void billings with balance > 0 (open AR). */
  openCount: number;
  /** Peso sum of PENDING 2307 amounts (kept for billing hub; count is separate). */
  pending2307: string;
  /** Billings expecting a 2307 with none recorded yet. */
  pending2307Count: number;
  credit: string;
  byCustomer: CustomerAgingRow[];
  graceDays: number;
}> {
  const snap = await getSettingsSnapshot();
  const grace = snap.settings.collections.overdueGraceDays;
  const today = billingToday();
  const billings = await db.billing.findMany({
    where: { status: { not: "VOID" } },
    include: {
      customer: { select: { id: true, name: true } },
      allocations: { where: { collection: { status: "POSTED" } } },
    },
  });
  const byCustomer = new Map<string, { name: string; rows: { dueDate: Date; balance: string }[]; overdue: bigint }>();
  let totalRecv = 0n;
  let totalOverdue = 0n;
  let overdueCount = 0;
  let openCount = 0;
  for (const b of billings) {
    const balance = billingBalance(money(b.amount), appliedOf(b.allocations));
    const bal = toScaled(balance, 2);
    if (bal <= 0n) continue;
    openCount += 1;
    totalRecv += bal;
    const od = isOverdue(b.dueDate, balance, today, grace);
    if (od) {
      totalOverdue += bal;
      overdueCount += 1;
    }
    const bucket = byCustomer.get(b.customerId) ?? { name: b.customer.name, rows: [], overdue: 0n };
    bucket.rows.push({ dueDate: b.dueDate, balance });
    if (od) bucket.overdue += bal;
    byCustomer.set(b.customerId, bucket);
  }

  const [pending2307, pending2307Count, creditsByCustomer] = await Promise.all([
    db.withholding2307.aggregate({
      where: { status: "PENDING", amount: { gt: 0 }, collection: { status: "POSTED" } },
      _sum: { amount: true },
    }),
    countPending2307Expected(),
    customerCreditsGrouped(),
  ]);

  const customers: CustomerAgingRow[] = [...byCustomer.entries()].map(([customerId, v]) => ({
    customerId,
    customerName: v.name,
    aging: sumAging(v.rows, today),
    overdue: fromScaled(v.overdue, 2),
    credit: creditsByCustomer.get(customerId)?.credit ?? "0.00",
  }));

  let totalCredit = customers.reduce((a, row) => a + toScaled(row.credit, 2), 0n);

  // Also include customers with credit but no open AR.
  for (const [customerId, v] of creditsByCustomer) {
    if (byCustomer.has(customerId)) continue;
    if (toScaled(v.credit, 2) <= 0n) continue;
    totalCredit += toScaled(v.credit, 2);
    customers.push({
      customerId,
      customerName: v.name,
      aging: emptyAging(),
      overdue: "0.00",
      credit: v.credit,
    });
  }

  customers.sort((a, b) => b.aging.total.localeCompare(a.aging.total) || a.customerName.localeCompare(b.customerName));

  return {
    totalReceivable: fromScaled(totalRecv, 2),
    overdue: fromScaled(totalOverdue, 2),
    overdueCount,
    openCount,
    pending2307: money(pending2307._sum.amount ?? 0),
    pending2307Count,
    credit: fromScaled(totalCredit, 2),
    byCustomer: customers,
    graceDays: grace,
  };
}

export async function list2307(filters: { status?: Withholding2307Status | "ALL"; customerId?: string } = {}) {
  const where: {
    amount: { gt: number };
    status?: Withholding2307Status;
    customerId?: string;
    collection: { status: "POSTED" };
  } = { amount: { gt: 0 }, collection: { status: "POSTED" } };
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  if (filters.customerId) where.customerId = filters.customerId;
  const rows = await db.withholding2307.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      billing: { select: { id: true, number: true, invoiceNo: true } },
      collection: { select: { id: true, number: true, date: true } },
      attachments: { where: { archivedAt: null } },
      lines: { orderBy: [{ atcCode: "asc" }, { createdAt: "asc" }] },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  // One display row per ATC line (fallback to parent when no lines yet).
  return rows.flatMap((w) => {
    const base = {
      parentId: w.id,
      status: w.status,
      receivedAt: ymd(w.receivedAt),
      customer: w.customer,
      billing: w.billing,
      collection: w.collection ? { ...w.collection, date: ymd(w.collection.date)! } : null,
      attachments: w.attachments.map((a) => ({ id: a.id, fileName: a.fileName, href: `/files/attachments/${a.id}` })),
    };
    const activeLines = w.lines.filter((l) => toScaled(money(l.amount), 2) > 0n);
    const lines =
      activeLines.length > 0
        ? activeLines
        : w.lines.length === 0
          ? [{ id: w.id, rate: w.rate, atcCode: w.atcCode, amount: w.amount }]
          : [];
    return lines.map((line, i) => ({
      ...base,
      id: line.id,
      // Mark-received acts on the parent; first line carries the action control.
      markId: i === 0 ? w.id : null,
      amount: money(line.amount),
      rate: String(line.rate),
      atcCode: line.atcCode,
    }));
  });
}

export async function getBookletView() {
  const snap = await getSettingsSnapshot();
  const range = snap.settings.invoiceBooklet;
  const used = await db.billing.findMany({
    where: { invoiceNo: { gte: range.seriesFrom, lte: range.seriesTo } },
    select: { id: true, number: true, invoiceNo: true, status: true },
  });
  return { range, ...bookletGrid(range, used) };
}

export async function customerArSnapshot(customerId: string) {
  const snap = await getSettingsSnapshot();
  const grace = snap.settings.collections.overdueGraceDays;
  const today = billingToday();
  const billings = await db.billing.findMany({
    where: { customerId, status: { not: "VOID" } },
    include: { allocations: { where: { collection: { status: "POSTED" } } } },
  });
  const rows = billings.map((b) => {
    const balance = billingBalance(money(b.amount), appliedOf(b.allocations));
    return { dueDate: b.dueDate, balance, overdue: isOverdue(b.dueDate, balance, today, grace) };
  });
  const aging = sumAging(rows, today);
  const overdue = fromScaled(
    rows.filter((r) => r.overdue).reduce((a, r) => a + toScaled(r.balance, 2), 0n),
    2,
  );
  const credit = await customerCreditBalance(customerId);
  const anyOverdue = rows.some((r) => r.overdue);
  return { aging, overdue, credit, anyOverdue, graceDays: grace, balanceDue: aging.total };
}

/** Statement of account data (printable). Title must say it's not an official invoice. */
export async function getStatement(customerId: string, from?: Date | null, to?: Date | null) {
  const snap = await getSettingsSnapshot();
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      addresses: { where: { archivedAt: null, kind: "BILLING" }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], take: 1 },
    },
  });
  if (!customer) return null;

  const billingWhere: { customerId: string; status: { not: "VOID" }; invoiceDate?: { gte?: Date; lte?: Date } } = {
    customerId,
    status: { not: "VOID" },
  };
  if (from || to) {
    billingWhere.invoiceDate = {};
    if (from) billingWhere.invoiceDate.gte = from;
    if (to) billingWhere.invoiceDate.lte = to;
  }

  const billings = await db.billing.findMany({
    where: billingWhere,
    include: { allocations: { where: { collection: { status: "POSTED" } } } },
    orderBy: [{ invoiceDate: "asc" }, { invoiceNo: "asc" }],
  });
  const collections = await db.collection.findMany({
    where: {
      customerId,
      status: "POSTED",
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: { allocations: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  // Opening balance: billings before `from` still open, minus collections before `from`.
  let opening = 0n;
  if (from) {
    const priorBillings = await db.billing.findMany({
      where: { customerId, status: { not: "VOID" }, invoiceDate: { lt: from } },
      // Only applications dated before `from` (not today's full allocation history).
      include: { allocations: { where: { collection: { status: "POSTED" }, appliedOn: { lt: from } } } },
    });
    for (const b of priorBillings) {
      opening += toScaled(billingBalance(money(b.amount), appliedOf(b.allocations)), 2);
    }
    // Unapplied credit as of `from`: prior collections minus applications before `from`.
    const priorCols = await db.collection.findMany({
      where: { customerId, status: "POSTED", date: { lt: from } },
      include: { allocations: true },
    });
    const openingCredit = openingCreditAsOf(
      priorCols.map((c) => ({
        amountReceived: money(c.amountReceived),
        applications: c.allocations.map((a) => ({ cashApplied: money(a.cashApplied), date: a.appliedOn })),
      })),
      from,
    );
    opening -= toScaled(openingCredit, 2);
  }

  type Line =
    | { kind: "billing"; date: string; invoiceNo: number; dueDate: string; amount: string; id: string }
    | {
        kind: "collection";
        date: string;
        method: CollectionMethod;
        receiptNo: string | null;
        cash: string;
        withholding: string;
        id: string;
        unapplied: string;
      };

  const lines: Line[] = [];
  for (const b of billings) {
    lines.push({
      kind: "billing",
      date: ymd(b.invoiceDate)!,
      invoiceNo: b.invoiceNo,
      dueDate: ymd(b.dueDate)!,
      amount: money(b.amount),
      id: b.id,
    });
  }
  for (const c of collections) {
    const cash = fromScaled(
      c.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n),
      2,
    );
    const wh = fromScaled(
      c.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n),
      2,
    );
    lines.push({
      kind: "collection",
      date: ymd(c.date)!,
      method: c.method,
      receiptNo: c.receiptNo,
      cash,
      withholding: wh,
      unapplied: unappliedCash(money(c.amountReceived), c.allocations.map((a) => money(a.cashApplied))),
      id: c.id,
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  let running = opening;
  const withBalance = lines.map((line) => {
    if (line.kind === "billing") running += toScaled(line.amount, 2);
    else {
      running -= toScaled(line.cash, 2) + toScaled(line.withholding, 2);
      // Unapplied credit still reduces what the customer owes in net terms when shown as credit.
      running -= toScaled(line.unapplied, 2);
    }
    return { ...line, runningBalance: fromScaled(running, 2) };
  });

  const ar = await customerArSnapshot(customerId);
  const billingAddress = customer.addresses[0] ? formatAddress(customer.addresses[0]) : customer.address;

  return {
    disclaimer: "Statement of account — not an official invoice. System-generated, no signature required.",
    company: snap.settings.company,
    customer: { id: customer.id, name: customer.name, tin: customer.tin, address: billingAddress },
    from: from ? ymd(from) : null,
    to: to ? ymd(to) : null,
    openingBalance: fromScaled(opening, 2),
    lines: withBalance,
    closingBalance: fromScaled(running, 2),
    credit: ar.credit,
    aging: ar.aging,
  };
}

/** Gross billings YTD for the tax year (same source as the sidebar non-VAT meter). */
export async function taxYearBillingMeter() {
  const snap = await getSettingsSnapshot();
  const meter = await getNonVatMeter(snap.settings.taxYear);
  return {
    year: meter.year,
    gross: fromScaled(toScaled(meter.used, 2), 2),
    limit: fromScaled(toScaled(meter.limit, 2), 2),
    pct: meter.pct,
    warnFirstPct: meter.warnFirstPct,
    warnSecondPct: meter.warnSecondPct,
  };
}
