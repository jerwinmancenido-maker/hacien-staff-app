// Read models for payables pages: payments list/detail, AP aging, 2307 to issue.

import type { SupplierBillStatus, SupplierPaymentMethod, SupplierPaymentStatus, SupplierWithholding2307Status } from "@prisma/client";
import { db } from "../db";
import { money, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { agingBucket, emptyAging, sumAging, type AgingAmounts, type AgingBucket } from "../billing/aging";
import { billingToday } from "../billing/dates";
import { supplierBillBalance } from "./status";

export const SUPPLIER_BILL_STATUS_LABELS: Record<SupplierBillStatus, string> = {
  RECORDED: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  VOID: "Void",
};

export const PAYMENT_STATUS_LABELS: Record<SupplierPaymentStatus, string> = {
  POSTED: "Posted",
  VOID: "Void",
};

export const SUPPLIER_2307_STATUS_LABELS: Record<SupplierWithholding2307Status, string> = {
  TO_ISSUE: "To issue",
  ISSUED: "Issued",
};

function appliedOf(allocs: { cashApplied: unknown; withholdingApplied: unknown }[]) {
  const cash = allocs.reduce((a, x) => a + toScaled(money(x.cashApplied as never), 2), 0n);
  const wh = allocs.reduce((a, x) => a + toScaled(money(x.withholdingApplied as never), 2), 0n);
  return { cashApplied: fromScaled(cash, 2), withholdingApplied: fromScaled(wh, 2) };
}

export async function listSupplierPayments(filters: {
  supplierId?: string;
  status?: SupplierPaymentStatus | "ALL";
  q?: string;
} = {}) {
  const where: {
    supplierId?: string;
    status?: SupplierPaymentStatus;
    OR?: ({ number: { contains: string } } | { supplier: { name: { contains: string } } } | { reference: { contains: string } })[];
  } = {};
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [{ number: { contains: q } }, { supplier: { name: { contains: q } } }, { reference: { contains: q } }];
  }
  const rows = await db.supplierPayment.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      cashAccount: { select: { id: true, name: true } },
      allocations: true,
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map((p) => {
    const cash = fromScaled(p.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n), 2);
    const wh = fromScaled(p.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n), 2);
    return {
      id: p.id,
      number: p.number,
      date: ymd(p.date)!,
      method: p.method as SupplierPaymentMethod,
      reference: p.reference,
      amountPaid: money(p.amountPaid),
      cashAccount: p.cashAccount,
      cashApplied: cash,
      withholdingTotal: wh,
      status: p.status,
      supplier: p.supplier,
    };
  });
}

export async function getSupplierPaymentView(id: string) {
  const p = await db.supplierPayment.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, taxType: true } },
      cashAccount: { select: { id: true, name: true } },
      allocations: {
        include: {
          supplierBill: {
            select: {
              id: true,
              billNumber: true,
              amount: true,
              dueDate: true,
              status: true,
              purchaseOrderId: true,
            },
          },
        },
      },
      withholdings: true,
      attachments: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!p) return null;
  const cash = fromScaled(p.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n), 2);
  const wh = fromScaled(p.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n), 2);
  return {
    id: p.id,
    number: p.number,
    date: ymd(p.date)!,
    method: p.method,
    reference: p.reference,
    checkBank: p.checkBank,
    checkDate: ymd(p.checkDate),
    amountPaid: money(p.amountPaid),
    cashAccount: p.cashAccount,
    cashApplied: cash,
    withholdingTotal: wh,
    notes: p.notes,
    status: p.status,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
    supplier: p.supplier,
    allocations: p.allocations.map((a) => ({
      id: a.id,
      cashApplied: money(a.cashApplied),
      withholdingApplied: money(a.withholdingApplied),
      withholdingRate: Number(a.withholdingRate).toFixed(4),
      atcCode: a.atcCode,
      supplierBill: {
        id: a.supplierBill.id,
        billNumber: a.supplierBill.billNumber,
        amount: money(a.supplierBill.amount),
        dueDate: ymd(a.supplierBill.dueDate)!,
        status: a.supplierBill.status,
        purchaseOrderId: a.supplierBill.purchaseOrderId,
      },
    })),
    withholdings: p.withholdings.map((w) => ({
      id: w.id,
      amount: money(w.amount),
      rate: Number(w.rate).toFixed(4),
      atcCode: w.atcCode,
      status: w.status,
      issuedAt: ymd(w.issuedAt),
    })),
    attachments: p.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      href: `/files/attachments/${a.id}`,
    })),
  };
}

export async function listSupplierBillsOpen(
  filters: {
    supplierId?: string;
    status?: SupplierBillStatus | "ALL";
    /** Inclusive Manila YYYY-MM-DD bounds on dueDate. */
    dueFromYmd?: string;
    dueToYmd?: string;
    /** When true, drop rows whose open balance is ₱0. */
    openBalanceOnly?: boolean;
  } = {},
) {
  const where: {
    supplierId?: string;
    status?: SupplierBillStatus | { not: "VOID" } | { in: SupplierBillStatus[] };
    dueDate?: { gte?: Date; lte?: Date };
  } = {};
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  else if (filters.openBalanceOnly) where.status = { in: ["RECORDED", "PARTIALLY_PAID"] };
  else where.status = { not: "VOID" };
  if (filters.dueFromYmd || filters.dueToYmd) {
    where.dueDate = {
      ...(filters.dueFromYmd ? { gte: new Date(`${filters.dueFromYmd}T00:00:00.000Z`) } : {}),
      ...(filters.dueToYmd ? { lte: new Date(`${filters.dueToYmd}T00:00:00.000Z`) } : {}),
    };
  }
  const rows = await db.supplierBill.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      allocations: { where: { supplierPayment: { status: "POSTED" } } },
      purchaseOrder: { select: { id: true, number: true } },
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
    take: 500,
  });
  const today = billingToday();
  const mapped = rows.map((b) => {
    const applied = appliedOf(b.allocations);
    const balance = supplierBillBalance(money(b.amount), applied);
    return {
      id: b.id,
      billNumber: b.billNumber,
      billDate: ymd(b.billDate)!,
      dueDate: ymd(b.dueDate)!,
      amount: money(b.amount),
      balance,
      status: b.status,
      supplier: b.supplier,
      purchaseOrder: b.purchaseOrder,
      aging: agingBucket(b.dueDate, today) as AgingBucket,
    };
  });
  if (filters.openBalanceOnly) return mapped.filter((r) => toScaled(r.balance, 2) > 0n);
  return mapped;
}

/** Unpaid supplier bills due from Manila today through today + N days (inclusive). */
export async function listSupplierBillsDueSoon(withinDays: number, now: Date = new Date()) {
  const today = billingToday(now);
  const fromYmd = ymd(today)!;
  const toYmd = ymd(new Date(today.getTime() + withinDays * 86_400_000))!;
  return listSupplierBillsOpen({ dueFromYmd: fromYmd, dueToYmd: toYmd, openBalanceOnly: true });
}

export type ApAgingRow = {
  supplierId: string;
  supplierName: string;
  aging: AgingAmounts;
};

export async function apAgingSummary(today = billingToday()) {
  const bills = await db.supplierBill.findMany({
    where: { status: { in: ["RECORDED", "PARTIALLY_PAID"] } },
    include: {
      supplier: { select: { id: true, name: true } },
      allocations: { where: { supplierPayment: { status: "POSTED" } } },
    },
  });
  const bySupplier = new Map<string, { name: string; rows: { dueDate: Date; balance: string }[] }>();
  for (const b of bills) {
    const applied = appliedOf(b.allocations);
    const balance = supplierBillBalance(money(b.amount), applied);
    if (toScaled(balance, 2) <= 0n) continue;
    const entry = bySupplier.get(b.supplierId) ?? { name: b.supplier.name, rows: [] };
    entry.rows.push({ dueDate: b.dueDate, balance });
    bySupplier.set(b.supplierId, entry);
  }
  const bySupplierRows: ApAgingRow[] = [...bySupplier.entries()]
    .map(([supplierId, v]) => ({
      supplierId,
      supplierName: v.name,
      aging: sumAging(v.rows, today),
    }))
    .sort((a, b) => {
      const diff = toScaled(b.aging.total, 2) - toScaled(a.aging.total, 2);
      if (diff > 0n) return 1;
      if (diff < 0n) return -1;
      return a.supplierName.localeCompare(b.supplierName);
    });

  const totals = bySupplierRows.reduce(
    (acc, r) => {
      for (const k of Object.keys(acc) as (keyof AgingAmounts)[]) {
        if (k === "total") continue;
        acc[k] = fromScaled(toScaled(acc[k], 2) + toScaled(r.aging[k], 2), 2);
      }
      acc.total = fromScaled(toScaled(acc.total, 2) + toScaled(r.aging.total, 2), 2);
      return acc;
    },
    emptyAging(),
  );

  const toIssue = await db.supplierWithholding2307.aggregate({
    where: { status: "TO_ISSUE", amount: { gt: 0 } },
    _sum: { amount: true },
  });

  return {
    bySupplier: bySupplierRows,
    totals,
    totalPayable: totals.total,
    pending2307ToIssue: money(toIssue._sum.amount ?? 0),
  };
}

export async function listSupplier2307(filters: { status?: SupplierWithholding2307Status | "ALL"; supplierId?: string } = {}) {
  const status = filters.status ?? "TO_ISSUE";
  const rows = await db.supplierWithholding2307.findMany({
    where: {
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(status !== "ALL" ? { status } : {}),
      // Hide zeroed (void-cleared) rows from to-issue / all lists.
      ...(status === "ISSUED" ? {} : { amount: { gt: 0 } }),
    },
    include: {
      supplier: { select: { id: true, name: true } },
      supplierPayment: { select: { id: true, number: true } },
      supplierBill: { select: { id: true, billNumber: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  return rows.map((w) => ({
    id: w.id,
    amount: money(w.amount),
    rate: Number(w.rate).toFixed(4),
    atcCode: w.atcCode,
    status: w.status,
    issuedAt: ymd(w.issuedAt),
    supplier: w.supplier,
    payment: w.supplierPayment,
    bill: w.supplierBill,
  }));
}

export async function supplierPayableBalance(supplierId: string): Promise<string> {
  const bills = await db.supplierBill.findMany({
    where: { supplierId, status: { in: ["RECORDED", "PARTIALLY_PAID"] } },
    include: { allocations: { where: { supplierPayment: { status: "POSTED" } } } },
  });
  let bal = 0n;
  for (const b of bills) {
    const applied = appliedOf(b.allocations);
    bal += toScaled(supplierBillBalance(money(b.amount), applied), 2);
  }
  return fromScaled(bal, 2);
}
