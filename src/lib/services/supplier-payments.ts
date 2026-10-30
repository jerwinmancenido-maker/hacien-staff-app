// Supplier payments (PAY-YYYY-####): hand-recorded bank payments to suppliers.
// The app never connects to a bank or payment API and never sends email.
// Allocations must equal cash paid exactly (no unapplied supplier advances).

import type { Prisma, SupplierBillStatus } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { validatePaymentAllocations, type BillForAlloc, type PaymentAllocationInput } from "../payables/allocations";
import { deriveSupplierBillStatus } from "../payables/status";
import type { MarkSupplier2307IssuedInput, SupplierPaymentInput } from "../validation/payables";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";

export type PayablesActor = PermissionUser & { id: string };

function assertManagePayables(actor: PayablesActor) {
  assertCan(actor, "manage_payables");
}

async function lockSupplier(tx: Tx, supplierId: string) {
  const rows = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT \`id\`, \`name\` FROM \`Supplier\` WHERE \`id\` = ${supplierId} FOR UPDATE`;
  if (!rows[0]) throw new DocRuleError("Supplier not found.");
  return rows[0];
}

async function lockBills(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  // Lock in id order to avoid deadlocks between concurrent payments.
  const sorted = [...ids].sort();
  for (const id of sorted) {
    await tx.$queryRaw`SELECT \`id\` FROM \`SupplierBill\` WHERE \`id\` = ${id} FOR UPDATE`;
  }
}

/** After FOR UPDATE: reject void / already-paid bills with an actionable message. */
async function assertBillsAllocatable(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const rows = await tx.supplierBill.findMany({
    where: { id: { in: unique } },
    select: { id: true, billNumber: true, status: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of unique) {
    const b = byId.get(id);
    if (!b) {
      throw new DocRuleError("One of those bills was not found. Refresh the page and try again.", "allocations");
    }
    if (b.status === "VOID") {
      throw new DocRuleError(`Bill ${b.billNumber} is void. Remove it from this payment.`, "allocations");
    }
    if (b.status === "PAID") {
      throw new DocRuleError(
        `Bill ${b.billNumber} is already fully paid. Refresh and pick unpaid bills.`,
        "allocations",
      );
    }
  }
}

async function billsForAlloc(
  tx: Tx,
  supplierId: string,
  excludePaymentId?: string,
): Promise<(BillForAlloc & { dueDate: Date; billNumber: string; purchaseOrderId: string | null })[]> {
  const rows = await tx.supplierBill.findMany({
    // PAID/VOID are not allocatable; remaining balance is computed from posted payments.
    where: { supplierId, status: { in: ["RECORDED", "PARTIALLY_PAID"] } },
    include: {
      allocations: {
        where: {
          supplierPayment: { status: "POSTED", ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    billNumber: b.billNumber,
    purchaseOrderId: b.purchaseOrderId,
    amount: money(b.amount),
    dueDate: b.dueDate,
    alreadyCash: fromScaled(
      b.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n),
      2,
    ),
    alreadyWithholding: fromScaled(
      b.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n),
      2,
    ),
  }));
}

export async function recomputeSupplierBillStatus(tx: Tx, billId: string) {
  const bill = await tx.supplierBill.findUniqueOrThrow({ where: { id: billId } });
  if (bill.status === "VOID") return bill;
  const allocs = await tx.supplierPaymentAllocation.findMany({
    where: { supplierBillId: billId, supplierPayment: { status: "POSTED" } },
  });
  const cash = fromScaled(allocs.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n), 2);
  const wh = fromScaled(allocs.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n), 2);
  const status: SupplierBillStatus = deriveSupplierBillStatus(money(bill.amount), {
    cashApplied: cash,
    withholdingApplied: wh,
  });
  if (status === bill.status) return bill;
  return tx.supplierBill.update({ where: { id: billId }, data: { status } });
}

async function upsertSupplier2307(
  tx: Tx,
  args: {
    supplierBillId: string;
    supplierPaymentId: string;
    supplierId: string;
    amount: string;
    rate: string;
    atcCode: string | null;
  },
) {
  if (toScaled(args.amount, 2) <= 0n) {
    const existing = await tx.supplierWithholding2307.findFirst({
      where: { supplierBillId: args.supplierBillId, supplierPaymentId: args.supplierPaymentId, status: "TO_ISSUE" },
    });
    if (existing) {
      await tx.supplierWithholding2307.update({
        where: { id: existing.id },
        data: { amount: "0.00", notes: "Cleared — withholding no longer applied." },
      });
    }
    return null;
  }
  const existing = await tx.supplierWithholding2307.findFirst({
    where: { supplierBillId: args.supplierBillId, supplierPaymentId: args.supplierPaymentId },
  });
  if (existing) {
    if (existing.status === "ISSUED") return existing;
    return tx.supplierWithholding2307.update({
      where: { id: existing.id },
      data: { amount: args.amount, rate: args.rate, atcCode: args.atcCode },
    });
  }
  return tx.supplierWithholding2307.create({
    data: {
      supplierBillId: args.supplierBillId,
      supplierPaymentId: args.supplierPaymentId,
      supplierId: args.supplierId,
      rate: args.rate,
      atcCode: args.atcCode,
      amount: args.amount,
      status: "TO_ISSUE",
    },
  });
}

export async function recordSupplierPayment(input: SupplierPaymentInput, actor: PayablesActor, files: readonly UploadFile[] = []) {
  assertManagePayables(actor);
  if (toScaled(input.amountPaid, 2) <= 0n) throw new DocRuleError("Amount paid must be greater than 0.", "amountPaid");

  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.supplierPayment;
  const year = input.date.getUTCFullYear();
  await ensureSeries(db, "SUPPLIER_PAYMENT", year, format);
  const uploads = await prepareUploads(files);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const supplier = await lockSupplier(tx, input.supplierId);
        const allocInputs: PaymentAllocationInput[] = input.allocations.map((a) => ({
          supplierBillId: a.supplierBillId,
          cashApplied: a.cashApplied,
          withholdingApplied: a.withholdingApplied,
          withholdingRate: a.withholdingRate,
          atcCode: a.atcCode ?? null,
        }));
        const billIds = allocInputs.map((a) => a.supplierBillId);
        await lockBills(tx, billIds);
        await assertBillsAllocatable(tx, billIds);
        const open = await billsForAlloc(tx, supplier.id);
        const issue = validatePaymentAllocations(input.amountPaid, allocInputs, open);
        if (issue) throw new DocRuleError(issue.message, issue.field);

        if (input.cashAccountId) {
          const acct = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
          if (!acct || !acct.active) {
            throw new DocRuleError("Pick an active cash account, or leave it blank (Not assigned).", "cashAccountId");
          }
        }

        const number = await allocateDocNumber(tx, "SUPPLIER_PAYMENT", year, format);
        const payment = await tx.supplierPayment.create({
          data: {
            number,
            supplierId: supplier.id,
            date: input.date,
            method: input.method,
            reference: input.reference,
            checkBank: input.checkBank,
            checkDate: input.checkDate,
            amountPaid: input.amountPaid,
            cashAccountId: input.cashAccountId ?? null,
            notes: input.notes,
            createdById: actor.id,
          },
        });

        const touched = new Set<string>();
        let whTotal = 0n;
        for (const a of allocInputs) {
          const cash = money(a.cashApplied);
          const wh = money(a.withholdingApplied);
          const rate = a.withholdingRate || "0.0000";
          if (toScaled(cash, 2) === 0n && toScaled(wh, 2) === 0n) continue;
          await tx.supplierPaymentAllocation.create({
            data: {
              supplierPaymentId: payment.id,
              supplierBillId: a.supplierBillId,
              cashApplied: cash,
              withholdingApplied: wh,
              withholdingRate: rate,
              atcCode: a.atcCode,
            },
          });
          touched.add(a.supplierBillId);
          whTotal += toScaled(wh, 2);
          if (toScaled(wh, 2) > 0n) {
            await upsertSupplier2307(tx, {
              supplierBillId: a.supplierBillId,
              supplierPaymentId: payment.id,
              supplierId: supplier.id,
              amount: wh,
              rate,
              atcCode: a.atcCode,
            });
          }
        }
        for (const billId of touched) await recomputeSupplierBillStatus(tx, billId);

        await createAttachments(tx, uploads, { supplierPaymentId: payment.id }, actor.id);

        await writeAudit(tx, {
          userId: actor.id,
          entityType: "SupplierPayment",
          entityId: payment.id,
          action: "create",
          after: {
            number,
            supplier: supplier.name,
            date: ymd(input.date),
            method: input.method,
            reference: input.reference,
            amountPaid: input.amountPaid,
            cashAccountId: input.cashAccountId ?? null,
            withholdingTotal: fromScaled(whTotal, 2),
            allocations: allocInputs.length,
            attachments: uploads.length,
          },
        });
        return payment;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    throw e;
  }
}

export async function voidSupplierPayment(id: string, reason: string, actor: PayablesActor) {
  assertManagePayables(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`SupplierPayment\` WHERE \`id\` = ${id} FOR UPDATE`;
      const before = await tx.supplierPayment.findUnique({
        where: { id },
        include: { allocations: true, withholdings: true },
      });
      if (!before) throw new DocRuleError("Payment not found.");
      if (before.status === "VOID") throw new DocRuleError("This payment is already void.");

      await lockBills(
        tx,
        before.allocations.map((a) => a.supplierBillId),
      );

      const issued = before.withholdings.filter((w) => w.status === "ISSUED");
      if (issued.length) {
        throw new DocRuleError("This payment has an issued 2307. It can't be voided.");
      }

      const now = new Date();
      const after = await tx.supplierPayment.update({
        where: { id },
        data: { status: "VOID", voidedAt: now, voidReason: why },
      });
      for (const w of before.withholdings) {
        if (w.status === "TO_ISSUE") {
          await tx.supplierWithholding2307.update({
            where: { id: w.id },
            data: {
              amount: "0.00",
              notes: `Voided with payment ${before.number}: ${why}`,
            },
          });
        }
      }
      for (const a of before.allocations) await recomputeSupplierBillStatus(tx, a.supplierBillId);

      await tx.documentVoid.create({
        data: {
          docType: "SUPPLIER_PAYMENT",
          docNumber: before.number,
          docId: id,
          reason: why,
          snapshot: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
          voidedById: actor.id,
          voidedAt: now,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SupplierPayment",
        entityId: id,
        action: "void",
        before: { status: "POSTED", amountPaid: money(before.amountPaid) },
        after: { status: "VOID", voidReason: why },
        diff: false,
      });
      return after;
    }, DOC_TX),
  );
}

export async function markSupplier2307Issued(
  id: string,
  input: MarkSupplier2307IssuedInput,
  actor: PayablesActor,
  files: readonly UploadFile[] = [],
) {
  assertManagePayables(actor);
  const uploads = await prepareUploads(files);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`SupplierWithholding2307\` WHERE \`id\` = ${id} FOR UPDATE`;
      const row = await tx.supplierWithholding2307.findUnique({ where: { id } });
      if (!row) throw new DocRuleError("2307 record not found.");
      if (row.status === "ISSUED") throw new DocRuleError("This 2307 is already marked issued.");
      if (toScaled(money(row.amount), 2) <= 0n) throw new DocRuleError("Nothing to issue on a zero-amount 2307.");

      const after = await tx.supplierWithholding2307.update({
        where: { id },
        data: { status: "ISSUED", issuedAt: input.issuedAt, notes: input.notes ?? row.notes },
      });
      await createAttachments(tx, uploads, { supplierWithholding2307Id: id }, actor.id);
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SupplierWithholding2307",
        entityId: id,
        action: "update",
        before: { status: "TO_ISSUE" },
        after: { status: "ISSUED", issuedAt: ymd(input.issuedAt), attachments: uploads.length },
        diff: false,
      });
      return after;
    });
  } catch (e) {
    await discardUploads(uploads);
    throw e;
  }
}

/** Open bills for a supplier with remaining balances (for the payment form). */
export async function openSupplierBillsForPayment(supplierId: string) {
  return db.$transaction(async (tx) => {
    const open = await billsForAlloc(tx, supplierId);
    return open
      .map((b) => {
        const balance = fromScaled(
          toScaled(b.amount, 2) - toScaled(b.alreadyCash, 2) - toScaled(b.alreadyWithholding, 2),
          2,
        );
        return { ...b, balance };
      })
      .filter((b) => toScaled(b.balance, 2) > 0n);
  });
}
