// Supplier payment requests (ERP adoption item 3, 2026-11-28): a
// request-to-pay step in front of supplier payments. A request names ONE
// supplier bill, an amount (≤ what is still owed and not already covered
// by open requests) and a due date. Lifecycle: PENDING → APPROVED /
// REJECTED → PAID. Paying goes through the existing recordSupplierPayment
// service — this module never moves money itself; it only links an
// APPROVED request to the payment that settled it. Voiding the bill
// cancels its open requests in the bill's own transaction (see
// supplier-bills.ts); voiding the payment reverts the request to
// APPROVED (see supplier-payments.ts).

import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { DocRuleError, money, ymd } from "../documents/common";
import { type PermissionUser } from "../permissions";
import { fromScaled, toScaled } from "../quotes/calc";
import { supplierBillBalance } from "../payables/status";
import type { PaymentRequestInput } from "../validation/payables";
import { assertPoAccess, type PoActor } from "./purchase-orders";

export type PaymentRequestActor = PermissionUser & { id: string };

const OPEN_STATUSES = ["PENDING", "APPROVED"] as const;

async function lockBill(tx: Tx, billId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT \`id\` FROM \`SupplierBill\` WHERE \`id\` = ${billId} FOR UPDATE`;
  if (!rows[0]) throw new DocRuleError("Bill not found.");
  return tx.supplierBill.findUniqueOrThrow({ where: { id: billId } });
}

async function lockRequest(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT \`id\` FROM \`SupplierPaymentRequest\` WHERE \`id\` = ${id} FOR UPDATE`;
  if (!rows[0]) throw new DocRuleError("Payment request not found.");
  return tx.supplierPaymentRequest.findUniqueOrThrow({
    where: { id },
    include: { supplierBill: { select: { id: true, billNumber: true, supplierId: true } } },
  });
}

/** What is still owed on a bill: amount − posted cash − posted withholding. */
export async function billOutstandingInTx(
  tx: Tx,
  bill: { id: string; amount: string | number | { toFixed(n: number): string } },
): Promise<string> {
  const allocs = await tx.supplierPaymentAllocation.findMany({
    where: { supplierBillId: bill.id, supplierPayment: { status: "POSTED" } },
    select: { cashApplied: true, withholdingApplied: true },
  });
  const cash = fromScaled(allocs.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n), 2);
  const wh = fromScaled(allocs.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n), 2);
  return supplierBillBalance(money(bill.amount), { cashApplied: cash, withholdingApplied: wh });
}

/** Sum of PENDING + APPROVED (unpaid) request amounts against a bill. */
export async function openRequestTotalInTx(tx: Tx, billId: string, excludeId?: string): Promise<string> {
  const rows = await tx.supplierPaymentRequest.findMany({
    where: { supplierBillId: billId, status: { in: [...OPEN_STATUSES] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { amount: true },
  });
  return fromScaled(rows.reduce((a, x) => a + toScaled(money(x.amount), 2), 0n), 2);
}

export async function createPaymentRequest(input: PaymentRequestInput, actor: PoActor) {
  // Same gate as recording a supplier bill: edit_data + "Can see costs".
  assertPoAccess(actor);
  return db.$transaction(async (tx) => {
    const bill = await lockBill(tx, input.supplierBillId);
    if (bill.status === "VOID") throw new DocRuleError("This bill is void — it can't be paid.");
    if (bill.status === "PAID") throw new DocRuleError("This bill is already fully paid.");
    const amount = money(input.amount);
    if (toScaled(amount, 2) <= 0n) throw new DocRuleError("Amount must be greater than 0.", "amount");
    const outstanding = await billOutstandingInTx(tx, bill);
    const alreadyRequested = await openRequestTotalInTx(tx, bill.id);
    const available = fromScaled(toScaled(outstanding, 2) - toScaled(alreadyRequested, 2), 2);
    if (toScaled(amount, 2) > toScaled(available, 2)) {
      throw new DocRuleError(
        alreadyRequested !== "0.00"
          ? `Open requests already cover ${alreadyRequested} of the ${outstanding} still owed on this bill — the most you can request now is ${available}.`
          : `The most you can request is the ${outstanding} still owed on this bill.`,
        "amount",
      );
    }
    const request = await tx.supplierPaymentRequest.create({
      data: {
        supplierBillId: bill.id,
        amount,
        dueDate: input.dueDate,
        note: input.note,
        requestedById: actor.id,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SupplierPaymentRequest",
      entityId: request.id,
      action: "create",
      after: {
        billNumber: bill.billNumber,
        amount,
        dueDate: ymd(input.dueDate),
        note: input.note,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SupplierBill",
      entityId: bill.id,
      action: "update",
      before: null,
      after: { paymentRequested: amount, requestStatus: "PENDING" },
      diff: false,
    });
    return request;
  });
}

export async function approvePaymentRequest(id: string, actor: PoActor) {
  // Same gate as approving a supplier PO: "approve" + "Can see costs".
  assertPoAccess(actor, "approve");
  return db.$transaction(async (tx) => {
    const before = await lockRequest(tx, id);
    if (before.status !== "PENDING") {
      throw new DocRuleError(
        before.status === "APPROVED" ? "This request is already approved." : `This request is ${before.status.toLowerCase()} — it can't be approved.`,
      );
    }
    const now = new Date();
    const after = await tx.supplierPaymentRequest.update({
      where: { id },
      data: { status: "APPROVED", decidedById: actor.id, decidedAt: now, decisionNote: null },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SupplierPaymentRequest",
      entityId: id,
      action: "update",
      before: { status: "PENDING" },
      after: { status: "APPROVED", billNumber: before.supplierBill.billNumber, amount: money(before.amount) },
      diff: false,
    });
    return after;
  });
}

export async function rejectPaymentRequest(id: string, note: string, actor: PoActor) {
  assertPoAccess(actor, "approve");
  const why = note.trim();
  if (!why) throw new DocRuleError("Give a reason for rejecting this request.", "note");
  return db.$transaction(async (tx) => {
    const before = await lockRequest(tx, id);
    if (before.status !== "PENDING") {
      throw new DocRuleError(
        before.status === "REJECTED" ? "This request is already rejected." : `This request is ${before.status.toLowerCase()} — it can't be rejected.`,
      );
    }
    const now = new Date();
    const after = await tx.supplierPaymentRequest.update({
      where: { id },
      data: { status: "REJECTED", decidedById: actor.id, decidedAt: now, decisionNote: why },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SupplierPaymentRequest",
      entityId: id,
      action: "update",
      before: { status: "PENDING" },
      after: { status: "REJECTED", billNumber: before.supplierBill.billNumber, amount: money(before.amount), reason: why },
      diff: false,
    });
    return after;
  });
}

/**
 * Settle an APPROVED request from inside recordSupplierPayment's
 * transaction. The payment must allocate at least the request amount
 * (cash + withholding) to the request's bill; anything less refuses the
 * whole payment so PAID always means "this payment settled the request".
 */
export async function settlePaymentRequestInTx(
  tx: Tx,
  args: {
    requestId: string;
    supplierId: string;
    paymentId: string;
    paymentNumber: string;
    allocations: readonly { supplierBillId: string; cashApplied: string; withholdingApplied: string }[];
    actorId: string;
  },
) {
  const request = await lockRequest(tx, args.requestId);
  if (request.status !== "APPROVED") {
    throw new DocRuleError(
      request.status === "PAID"
        ? "That payment request is already paid."
        : "That payment request isn't approved — it can't be paid yet. Record the payment without the request link, or get the request approved first.",
      "paymentRequestId",
    );
  }
  if (request.supplierBill.supplierId !== args.supplierId) {
    throw new DocRuleError("That payment request belongs to a different supplier.", "paymentRequestId");
  }
  const alloc = args.allocations.find((a) => a.supplierBillId === request.supplierBillId);
  const covered = alloc ? fromScaled(toScaled(money(alloc.cashApplied), 2) + toScaled(money(alloc.withholdingApplied), 2), 2) : "0.00";
  if (toScaled(covered, 2) < toScaled(money(request.amount), 2)) {
    throw new DocRuleError(
      `This payment puts ${covered} against bill ${request.supplierBill.billNumber}, less than the approved request of ${money(request.amount)}. Put at least the request amount against that bill, or record the payment without the request link.`,
      "paymentRequestId",
    );
  }
  const now = new Date();
  const after = await tx.supplierPaymentRequest.update({
    where: { id: request.id },
    data: { status: "PAID", supplierPaymentId: args.paymentId, paidAt: now },
  });
  await writeAudit(tx, {
    userId: args.actorId,
    entityType: "SupplierPaymentRequest",
    entityId: request.id,
    action: "update",
    before: { status: "APPROVED" },
    after: { status: "PAID", billNumber: request.supplierBill.billNumber, amount: money(request.amount), payment: args.paymentNumber },
    diff: false,
  });
  return after;
}

/** A voided payment un-settles its requests: PAID → APPROVED, link cleared. */
export async function revertPaymentRequestsInTx(tx: Tx, paymentId: string, paymentNumber: string, actorId: string) {
  const paid = await tx.supplierPaymentRequest.findMany({
    where: { supplierPaymentId: paymentId, status: "PAID" },
    include: { supplierBill: { select: { billNumber: true } } },
  });
  for (const r of paid) {
    await tx.supplierPaymentRequest.update({
      where: { id: r.id },
      data: { status: "APPROVED", supplierPaymentId: null, paidAt: null },
    });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "SupplierPaymentRequest",
      entityId: r.id,
      action: "update",
      before: { status: "PAID", payment: paymentNumber },
      after: { status: "APPROVED", billNumber: r.supplierBill.billNumber, amount: money(r.amount), note: `Payment ${paymentNumber} was voided — the request is approved and unpaid again.` },
      diff: false,
    });
  }
  return paid.length;
}

/** Bill void cancels its open (PENDING / APPROVED-unpaid) requests in the same transaction. */
export async function cancelOpenRequestsForBillInTx(tx: Tx, billId: string, billNumber: string, reason: string, actorId: string) {
  const open = await tx.supplierPaymentRequest.findMany({
    where: { supplierBillId: billId, status: { in: [...OPEN_STATUSES] } },
    select: { id: true, status: true, amount: true },
  });
  const now = new Date();
  for (const r of open) {
    await tx.supplierPaymentRequest.update({
      where: { id: r.id },
      data: { status: "CANCELLED", decidedById: actorId, decidedAt: now, decisionNote: `Cancelled — bill ${billNumber} was voided: ${reason}` },
    });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "SupplierPaymentRequest",
      entityId: r.id,
      action: "update",
      before: { status: r.status },
      after: { status: "CANCELLED", billNumber, amount: money(r.amount), reason: `Bill voided: ${reason}` },
      diff: false,
    });
  }
  return open.length;
}
