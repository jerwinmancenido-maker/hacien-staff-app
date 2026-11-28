// Read models for supplier payment requests (ERP adoption item 3):
// the approver queue, the requester's own list, and per-bill summaries.

import type { Prisma, SupplierPaymentRequestStatus } from "@prisma/client";
import { db } from "../db";
import { money, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { supplierBillBalance } from "./status";

export const PAYMENT_REQUEST_STATUS_LABELS: Record<SupplierPaymentRequestStatus, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved — ready to pay",
  REJECTED: "Rejected",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export type PaymentRequestRow = {
  id: string;
  status: SupplierPaymentRequestStatus;
  amount: string;
  dueDate: string;
  note: string | null;
  createdAt: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  bill: {
    id: string;
    billNumber: string;
    amount: string;
    balance: string;
    dueDate: string;
    purchaseOrderId: string | null;
    purchaseOrderNumber: string | null;
  };
  supplier: { id: string; name: string };
  payment: { id: string; number: string } | null;
};

const rowInclude = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  supplierPayment: { select: { id: true, number: true } },
  supplierBill: {
    include: {
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, number: true } },
      allocations: { where: { supplierPayment: { status: "POSTED" } }, select: { cashApplied: true, withholdingApplied: true } },
    },
  },
} as const;

type RawRow = Awaited<ReturnType<typeof fetchRows>>[number];

function fetchRows(where: Prisma.SupplierPaymentRequestWhereInput, take = 200) {
  return db.supplierPaymentRequest.findMany({
    where,
    include: rowInclude,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take,
  });
}

function toRow(r: RawRow): PaymentRequestRow {
  const b = r.supplierBill;
  const cash = fromScaled(b.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n), 2);
  const wh = fromScaled(b.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n), 2);
  return {
    id: r.id,
    status: r.status,
    amount: money(r.amount),
    dueDate: ymd(r.dueDate)!,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    requestedBy: r.requestedBy,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    bill: {
      id: b.id,
      billNumber: b.billNumber,
      amount: money(b.amount),
      balance: supplierBillBalance(money(b.amount), { cashApplied: cash, withholdingApplied: wh }),
      dueDate: ymd(b.dueDate)!,
      purchaseOrderId: b.purchaseOrder?.id ?? null,
      purchaseOrderNumber: b.purchaseOrder?.number ?? null,
    },
    supplier: b.supplier,
    payment: r.supplierPayment,
  };
}

/** The queue page: open work for approvers + the viewer's own requests. */
export async function listPaymentRequestQueue(viewerId: string, canApprove: boolean) {
  const [pending, approved, mine] = await Promise.all([
    canApprove ? fetchRows({ status: "PENDING" }) : Promise.resolve([] as RawRow[]),
    canApprove ? fetchRows({ status: "APPROVED" }) : Promise.resolve([] as RawRow[]),
    fetchRows({ requestedById: viewerId }, 50),
  ]);
  return {
    pending: pending.map(toRow),
    approved: approved.map(toRow),
    mine: mine.map(toRow),
  };
}

/** Every request against one bill, newest first (bill / PO page). */
export async function listPaymentRequestsForBill(billId: string): Promise<PaymentRequestRow[]> {
  const rows = await db.supplierPaymentRequest.findMany({
    where: { supplierBillId: billId },
    include: rowInclude,
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
  return rows.map(toRow);
}

/** Open (PENDING/APPROVED) request totals per bill, for list badges. */
export async function openRequestTotalsByBill(billIds: string[]): Promise<Map<string, { count: number; total: string }>> {
  const out = new Map<string, { count: number; total: string }>();
  if (!billIds.length) return out;
  const rows = await db.supplierPaymentRequest.findMany({
    where: { supplierBillId: { in: billIds }, status: { in: ["PENDING", "APPROVED"] } },
    select: { supplierBillId: true, amount: true },
  });
  const sums = new Map<string, bigint>();
  for (const r of rows) {
    sums.set(r.supplierBillId, (sums.get(r.supplierBillId) ?? 0n) + toScaled(money(r.amount), 2));
    const cur = out.get(r.supplierBillId) ?? { count: 0, total: "0.00" };
    cur.count += 1;
    out.set(r.supplierBillId, cur);
  }
  for (const [id, v] of sums) {
    const cur = out.get(id)!;
    cur.total = fromScaled(v, 2);
  }
  return out;
}
