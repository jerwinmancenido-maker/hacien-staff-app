// Customer billings: record a hand-written booklet invoice against an OPEN SO.
// Internal number BL-YYYY-####. The app never titles or prints this as an Invoice.

import type { BillingStatus, Prisma } from "@prisma/client";
import { db, isUniqueViolation, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { bookletRangeError } from "../billing/booklet";
import { netExpected, proRataWithholding, remainingToBill } from "../billing/status";
import type { BillingInput } from "../validation/billing";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";

export type BillingActor = PermissionUser & { id: string };

function assertManageBilling(actor: BillingActor) {
  assertCan(actor, "manage_billing");
}

async function lockSalesOrder(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<
    { id: string; number: string; status: string; customerId: string; contractPrice: unknown; withholdingTotal: unknown; terms: string | null }[]
  >`SELECT \`id\`, \`number\`, \`status\`, \`customerId\`, \`contractPrice\`, \`withholdingTotal\`, \`terms\` FROM \`SalesOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
  if (!rows[0]) throw new DocRuleError("Sales order not found.");
  return {
    ...rows[0],
    contractPrice: money(String(rows[0].contractPrice)),
    withholdingTotal: money(String(rows[0].withholdingTotal)),
  };
}

/** Non-void billings on an SO (amounts), for remaining-to-bill checks. */
async function nonVoidBillings(tx: Tx, salesOrderId: string) {
  return tx.billing.findMany({
    where: { salesOrderId, status: { not: "VOID" } },
    select: { id: true, number: true, amount: true, invoiceNo: true },
  });
}

export async function recordBilling(input: BillingInput, actor: BillingActor, files: readonly UploadFile[] = []) {
  assertManageBilling(actor);
  if (toScaled(input.amount, 2) <= 0n) throw new DocRuleError("Amount must be greater than 0.", "amount");

  const snap = await getSettingsSnapshot();
  const range = snap.settings.invoiceBooklet;
  const rangeErr = bookletRangeError(input.invoiceNo, range);
  if (rangeErr) throw new DocRuleError(rangeErr, "invoiceNo");

  const format = snap.settings.numbering.billing;
  const year = input.invoiceDate.getUTCFullYear();
  await ensureSeries(db, "BILLING", year, format);
  const uploads = await prepareUploads(files);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const so = await lockSalesOrder(tx, input.salesOrderId);
        if (so.status !== "OPEN") throw new DocRuleError("Only open sales orders can be billed.");

        const existing = await nonVoidBillings(tx, so.id);
        const remaining = remainingToBill(
          so.contractPrice,
          existing.map((b) => money(b.amount)),
        );
        if (toScaled(input.amount, 2) > toScaled(remaining, 2)) {
          throw new DocRuleError(
            `Amount exceeds the remaining to bill on ${so.number} (₱${remaining} left).`,
            "amount",
          );
        }

        // Voided numbers stay used: unique on invoiceNo covers all rows.
        const taken = await tx.billing.findFirst({ where: { invoiceNo: input.invoiceNo }, select: { id: true, number: true, status: true } });
        if (taken) {
          throw new DocRuleError(
            `Booklet invoice no. ${input.invoiceNo} is already on billing ${taken.number}${taken.status === "VOID" ? " (voided — numbers are never reused)" : ""}.`,
            "invoiceNo",
          );
        }

        const withholdingExpected = proRataWithholding(input.amount, so.contractPrice, so.withholdingTotal);
        const net = netExpected(input.amount, withholdingExpected);
        const number = await allocateDocNumber(tx, "BILLING", year, format);

        const billing = await tx.billing.create({
          data: {
            number,
            salesOrderId: so.id,
            customerId: so.customerId,
            invoiceNo: input.invoiceNo,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate,
            amount: input.amount,
            withholdingExpected,
            netExpected: net,
            status: "OPEN",
            notes: input.notes,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        await createAttachments(tx, uploads, { billingId: billing.id }, actor.id);
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "Billing",
          entityId: billing.id,
          action: "create",
          after: {
            number,
            salesOrder: so.number,
            invoiceNo: billing.invoiceNo,
            invoiceDate: ymd(billing.invoiceDate),
            dueDate: ymd(billing.dueDate),
            amount: money(billing.amount),
            withholdingExpected,
            netExpected: net,
            attachments: uploads.length,
          },
        });
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "SalesOrder",
          entityId: so.id,
          action: "update",
          before: null,
          after: { billingRecorded: number, invoiceNo: billing.invoiceNo, amount: money(billing.amount) },
          diff: false,
        });
        return billing;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    if (isUniqueViolation(e)) {
      throw new DocRuleError(`Booklet invoice no. ${input.invoiceNo} was just taken by another billing.`, "invoiceNo");
    }
    throw e;
  }
}

export async function updateBilling(
  id: string,
  input: Omit<BillingInput, "salesOrderId"> & { salesOrderId?: string },
  actor: BillingActor,
) {
  assertManageBilling(actor);
  if (toScaled(input.amount, 2) <= 0n) throw new DocRuleError("Amount must be greater than 0.", "amount");

  const snap = await getSettingsSnapshot();
  const rangeErr = bookletRangeError(input.invoiceNo, snap.settings.invoiceBooklet);
  if (rangeErr) throw new DocRuleError(rangeErr, "invoiceNo");

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`Billing\` WHERE \`id\` = ${id} FOR UPDATE`;
      const before = await tx.billing.findUnique({ where: { id } });
      if (!before) throw new DocRuleError("Billing not found.");
      if (before.status === "VOID") throw new DocRuleError("This billing is void.");

      const postedAlloc = await tx.collectionAllocation.count({
        where: { billingId: id, collection: { status: "POSTED" } },
      });
      if (postedAlloc > 0) throw new DocRuleError("This billing has posted collections; void those first before editing.");

      const so = await lockSalesOrder(tx, before.salesOrderId);
      if (so.status !== "OPEN") throw new DocRuleError("The sales order is void; this billing can't be edited.");

      const others = (await nonVoidBillings(tx, so.id)).filter((b) => b.id !== id);
      const remaining = remainingToBill(
        so.contractPrice,
        others.map((b) => money(b.amount)),
      );
      if (toScaled(input.amount, 2) > toScaled(remaining, 2)) {
        throw new DocRuleError(`Amount exceeds the remaining to bill on ${so.number} (₱${remaining} left).`, "amount");
      }

      if (input.invoiceNo !== before.invoiceNo) {
        const taken = await tx.billing.findFirst({ where: { invoiceNo: input.invoiceNo }, select: { number: true, status: true } });
        if (taken) {
          throw new DocRuleError(
            `Booklet invoice no. ${input.invoiceNo} is already on billing ${taken.number}${taken.status === "VOID" ? " (voided — numbers are never reused)" : ""}.`,
            "invoiceNo",
          );
        }
      }

      const withholdingExpected = proRataWithholding(input.amount, so.contractPrice, so.withholdingTotal);
      const net = netExpected(input.amount, withholdingExpected);
      const after = await tx.billing.update({
        where: { id },
        data: {
          invoiceNo: input.invoiceNo,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          amount: input.amount,
          withholdingExpected,
          netExpected: net,
          notes: input.notes,
          updatedById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Billing",
        entityId: id,
        action: "update",
        before: {
          invoiceNo: before.invoiceNo,
          invoiceDate: ymd(before.invoiceDate),
          dueDate: ymd(before.dueDate),
          amount: money(before.amount),
          notes: before.notes,
        },
        after: {
          invoiceNo: after.invoiceNo,
          invoiceDate: ymd(after.invoiceDate),
          dueDate: ymd(after.dueDate),
          amount: money(after.amount),
          notes: after.notes,
        },
      });
      return after;
    }, DOC_TX),
  );
}

export async function voidBilling(id: string, reason: string, actor: BillingActor) {
  assertManageBilling(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`Billing\` WHERE \`id\` = ${id} FOR UPDATE`;
      const before = await tx.billing.findUnique({ where: { id } });
      if (!before) throw new DocRuleError("Billing not found.");
      if (before.status === "VOID") throw new DocRuleError("This billing is already void.");

      const postedAlloc = await tx.collectionAllocation.count({
        where: { billingId: id, collection: { status: "POSTED" } },
      });
      if (postedAlloc > 0) {
        throw new DocRuleError("This billing has posted collections. Void those first.");
      }

      const now = new Date();
      // invoiceNo stays set — voided booklet numbers are never reused.
      const after = await tx.billing.update({
        where: { id },
        data: { status: "VOID" satisfies BillingStatus, voidedAt: now, voidReason: why, updatedById: actor.id },
      });
      await tx.documentVoid.create({
        data: {
          docType: "BILLING",
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
        entityType: "Billing",
        entityId: id,
        action: "void",
        before: { status: before.status, invoiceNo: before.invoiceNo },
        after: { status: "VOID", voidReason: why, invoiceNo: before.invoiceNo },
        diff: false,
      });
      return after;
    }, DOC_TX),
  );
}

/** Recompute and persist a billing's status from its posted allocations. */
export async function recomputeBillingStatus(tx: Tx, billingId: string, actorId: string) {
  const billing = await tx.billing.findUniqueOrThrow({ where: { id: billingId } });
  if (billing.status === "VOID") return billing;
  const allocs = await tx.collectionAllocation.findMany({
    where: { billingId, collection: { status: "POSTED" } },
  });
  const cash = allocs.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
  const wh = allocs.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n);
  const amt = toScaled(money(billing.amount), 2);
  let status: BillingStatus = "OPEN";
  if (cash + wh <= 0n) status = "OPEN";
  else if (cash + wh >= amt) status = "PAID";
  else status = "PARTIALLY_PAID";
  if (status === billing.status) return billing;
  return tx.billing.update({ where: { id: billingId }, data: { status, updatedById: actorId } });
}

/** SO rollup: billed / remaining / collected / balance. */
export async function soBillingSummary(salesOrderId: string) {
  const so = await db.salesOrder.findUnique({ where: { id: salesOrderId }, select: { contractPrice: true } });
  if (!so) return null;
  const billings = await db.billing.findMany({
    where: { salesOrderId, status: { not: "VOID" } },
    include: { allocations: { where: { collection: { status: "POSTED" } } } },
  });
  const billed = billings.reduce((a, b) => a + toScaled(money(b.amount), 2), 0n);
  let cash = 0n;
  let wh = 0n;
  for (const b of billings) {
    for (const al of b.allocations) {
      cash += toScaled(money(al.cashApplied), 2);
      wh += toScaled(money(al.withholdingApplied), 2);
    }
  }
  const contract = toScaled(money(so.contractPrice), 2);
  return {
    contractPrice: fromScaled(contract, 2),
    billed: fromScaled(billed, 2),
    remainingToBill: fromScaled(contract - billed, 2),
    collected: fromScaled(cash + wh, 2),
    cashCollected: fromScaled(cash, 2),
    withholdingCollected: fromScaled(wh, 2),
    balance: fromScaled(billed - cash - wh, 2),
  };
}
