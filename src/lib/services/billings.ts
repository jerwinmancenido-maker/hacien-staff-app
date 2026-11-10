// Customer billings: record a hand-written booklet invoice against an OPEN SO.
// Internal number BL-YYYY-####. The app never titles or prints this as an Invoice.

import type { BillingStatus, Prisma } from "@prisma/client";
import { db, isUniqueViolation, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, assertCanMarkAdminCheck, staffNeedsAdminCheck, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { fromScaled, toScaled, withholdingBreakdownParts, type WithholdingSnapshot } from "../quotes/calc";
import { bookletRangeError, formatBookletNumber } from "../billing/booklet";
import { netExpected, proRataWithholding, remainingToBill } from "../billing/status";
import type { BillingInput } from "../validation/billing";
import { voidReasonSchema } from "../validation/quotes";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";
import { claimBookletSerial, lockSiBookletNumber, moveSiBookletClaim } from "./booklet";
import { refreshSalesOrderCloseState } from "./sales-orders";

export type BillingActor = PermissionUser & { id: string };

function assertManageBilling(actor: BillingActor) {
  assertCan(actor, "manage_billing");
}

async function lockSalesOrder(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<
    { id: string; number: string; status: string; customerId: string; contractPrice: unknown; withholdingTotal: unknown; terms: string | null; withholding: unknown }[]
  >`SELECT \`id\`, \`number\`, \`status\`, \`customerId\`, \`contractPrice\`, \`withholdingTotal\`, \`terms\`, \`withholding\` FROM \`SalesOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
  if (!rows[0]) throw new DocRuleError("Sales order not found.");
  return {
    ...rows[0],
    contractPrice: money(String(rows[0].contractPrice)),
    withholdingTotal: money(String(rows[0].withholdingTotal)),
  };
}

/** The billing's own withholding breakdown, captured from the SO at
 * record/edit time (A1 revised): the 2307 prefill splits from this stored
 * basis, so later SO edits can never move an issued SI's split. */
async function captureWithholdingBreakdown(tx: Tx, salesOrderId: string, soWithholding: unknown) {
  const items = await tx.salesOrderItem.findMany({
    where: { salesOrderId, removedAt: null },
    select: { kind: true, total: true, supplierTotal: true, margin: true },
  });
  const picks = (soWithholding ?? []) as WithholdingSnapshot[];
  const parts = withholdingBreakdownParts(
    items.map((i) => ({ kind: i.kind, total: money(i.total), supplierTotal: money(i.supplierTotal), margin: money(i.margin) })),
    picks.length ? picks : undefined,
  );
  return parts.length ? (parts as unknown as Prisma.InputJsonValue) : undefined;
}

/** Non-void billings on an SO (amounts), for remaining-to-bill checks. */
async function nonVoidBillings(tx: Tx, salesOrderId: string) {
  return tx.billing.findMany({
    where: { salesOrderId, status: { not: "VOID" } },
    select: { id: true, number: true, amount: true, invoiceNo: true },
  });
}

export async function recordBilling(input: BillingInput, actor: BillingActor, files: readonly UploadFile[] = []) {
  assertCan(actor, "record_billing");
  if (toScaled(input.amount, 2) <= 0n) throw new DocRuleError("Amount must be greater than 0.", "amount");

  const snap = await getSettingsSnapshot();
  const range = snap.settings.invoiceBooklet.salesInvoice ?? snap.settings.invoiceBooklet;
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

        // Voided numbers stay used: unique on invoiceNo + cross-table claim vs spoil.
        await lockSiBookletNumber(tx, input.invoiceNo);
        const taken = await tx.billing.findFirst({ where: { invoiceNo: input.invoiceNo }, select: { id: true, number: true, status: true } });
        const spoiled = await tx.spoiledBookletNumber.findFirst({ where: { type: "SI", number: input.invoiceNo }, select: { id: true } });
        if (taken || spoiled) {
          throw new DocRuleError(
            `SI no. ${formatBookletNumber(input.invoiceNo)} is already used / marked spoiled.`,
            "invoiceNo",
          );
        }
        await claimBookletSerial(tx, "SI", input.invoiceNo);

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
            withholdingBreakdown: await captureWithholdingBreakdown(tx, so.id, so.withholding),
            netExpected: net,
            status: "OPEN",
            notes: input.notes,
            needsAdminCheck: staffNeedsAdminCheck(actor),
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
        // Audit C: note it in the audit trail when the billing goes out
        // before anything was delivered (warn only — never a block).
        const deliveredCount = await tx.delivery.count({ where: { salesOrderId: so.id, voidedAt: null } });
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "SalesOrder",
          entityId: so.id,
          action: "update",
          before: null,
          after: {
            billingRecorded: number,
            invoiceNo: billing.invoiceNo,
            amount: money(billing.amount),
            ...(deliveredCount === 0 ? { billedBeforeDelivery: true } : {}),
          },
          diff: false,
        });
        // Audit A: a new billing can complete the order's money side.
        await refreshSalesOrderCloseState(tx, so.id, actor.id);
        return billing;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    if (isUniqueViolation(e)) {
      throw new DocRuleError(
        `SI no. ${formatBookletNumber(input.invoiceNo)} is already used / marked spoiled.`,
        "invoiceNo",
      );
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
  const range = snap.settings.invoiceBooklet.salesInvoice ?? snap.settings.invoiceBooklet;
  const rangeErr = bookletRangeError(input.invoiceNo, range);
  if (rangeErr) throw new DocRuleError(rangeErr, "invoiceNo");

  try {
    return await withTxRetry(() =>
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
        if (so.status !== "OPEN") throw new DocRuleError("The sales order is closed or void; this billing can't be edited.");

        const others = (await nonVoidBillings(tx, so.id)).filter((b) => b.id !== id);
        const remaining = remainingToBill(
          so.contractPrice,
          others.map((b) => money(b.amount)),
        );
        if (toScaled(input.amount, 2) > toScaled(remaining, 2)) {
          throw new DocRuleError(`Amount exceeds the remaining to bill on ${so.number} (₱${remaining} left).`, "amount");
        }

        await lockSiBookletNumber(tx, before.invoiceNo);
        await lockSiBookletNumber(tx, input.invoiceNo);
        if (input.invoiceNo !== before.invoiceNo) {
          const taken = await tx.billing.findFirst({ where: { invoiceNo: input.invoiceNo }, select: { number: true, status: true } });
          const spoiled = await tx.spoiledBookletNumber.findFirst({ where: { type: "SI", number: input.invoiceNo }, select: { id: true } });
          if (taken || spoiled) {
            throw new DocRuleError(
              `SI no. ${formatBookletNumber(input.invoiceNo)} is already used / marked spoiled.`,
              "invoiceNo",
            );
          }
          // Move claim with the billing (old serial becomes free). Void does not move/release.
          await moveSiBookletClaim(tx, before.invoiceNo, input.invoiceNo);
        } else {
          const spoiled = await tx.spoiledBookletNumber.findFirst({ where: { type: "SI", number: input.invoiceNo }, select: { id: true } });
          if (spoiled) {
            throw new DocRuleError(
              `SI no. ${formatBookletNumber(input.invoiceNo)} is already used / marked spoiled.`,
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
            withholdingBreakdown: await captureWithholdingBreakdown(tx, so.id, so.withholding),
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
        // Audit A: an amount change can complete (or un-complete) the order.
        await refreshSalesOrderCloseState(tx, before.salesOrderId, actor.id);
        return after;
      }, DOC_TX),
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new DocRuleError(
        `SI no. ${formatBookletNumber(input.invoiceNo)} is already used / marked spoiled.`,
        "invoiceNo",
      );
    }
    throw e;
  }
}

/** Staff can change the Expected by date on a government billing. */
export async function updateBillingExpectedDate(
  id: string,
  expectedDate: Date | null,
  actor: BillingActor,
) {
  assertCan(actor, "edit_data");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const before = await tx.billing.findUnique({ where: { id } });
      if (!before) throw new DocRuleError("Billing not found.");
      if (before.status === "VOID") throw new DocRuleError("This billing is void.");

      const after = await tx.billing.update({
        where: { id },
        data: {
          expectedDate,
          updatedById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Billing",
        entityId: id,
        action: "update",
        before: { expectedDate: ymd(before.expectedDate) },
        after: { expectedDate: ymd(after.expectedDate) },
      });
      return after;
    }, DOC_TX),
  );
}

export async function voidBilling(id: string, reason: string, actor: BillingActor) {
  assertManageBilling(actor);
  const parsedReason = voidReasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    throw new DocRuleError(parsedReason.error.issues[0]?.message ?? "A reason is required.", "reason");
  }
  const why = parsedReason.data;

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
      // Audit D: return-credit applications strand the credit if the billing
      // is voided — reverse the credit first (void the return).
      const creditApps = await tx.customerCreditApplication.count({ where: { billingId: id } });
      if (creditApps > 0) {
        throw new DocRuleError("This billing has return credit applied. Void the credit memo first.");
      }

      const now = new Date();
      // invoiceNo stays set — voided booklet numbers are never reused.
      const after = await tx.billing.update({
        where: { id },
        data: { status: "VOID" satisfies BillingStatus, voidedAt: now, voidReason: why, needsAdminCheck: false, updatedById: actor.id },
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
      // Audit A: voiding a billing can reopen a closed order.
      await refreshSalesOrderCloseState(tx, before.salesOrderId, actor.id);
      return after;
    }, DOC_TX),
  );
}

/** Admin clears the staff-recorded check flag. Same transaction as the audit row. */
export async function markBillingChecked(id: string, actor: BillingActor) {
  assertCanMarkAdminCheck(actor);
  return db.$transaction(async (tx) => {
    const before = await tx.billing.findUnique({ where: { id } });
    if (!before) throw new DocRuleError("Billing not found.");
    if (!before.needsAdminCheck) return before;
    const now = new Date();
    const after = await tx.billing.update({
      where: { id },
      data: { needsAdminCheck: false, adminCheckedAt: now, adminCheckedById: actor.id, updatedById: actor.id },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Billing",
      entityId: id,
      action: "update",
      before: { needsAdminCheck: true },
      after: { needsAdminCheck: false, adminCheckedAt: now.toISOString() },
      diff: false,
    });
    return after;
  });
}

/** Recompute and persist a billing's status from its posted allocations. */
export async function recomputeBillingStatus(tx: Tx, billingId: string, actorId: string) {
  const billing = await tx.billing.findUniqueOrThrow({ where: { id: billingId } });
  if (billing.status === "VOID") {
    await refreshSalesOrderCloseState(tx, billing.salesOrderId, actorId);
    return billing;
  }
  const allocs = await tx.collectionAllocation.findMany({
    where: { billingId, collection: { status: "POSTED" } },
  });
  // Audit D: return-credit applications reduce the balance just like cash.
  // Only applications whose return is still POSTED count — voiding a return
  // un-applies its credit (same pattern as voided collections).
  const creditApps = await tx.customerCreditApplication.findMany({
    where: { billingId, customerCredit: { customerReturn: { status: "POSTED" } } },
  });
  const cash =
    allocs.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n) +
    creditApps.reduce((a, x) => a + toScaled(money(String(x.cashApplied)), 2), 0n);
  const wh = allocs.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n);
  const amt = toScaled(money(billing.amount), 2);
  let status: BillingStatus = "OPEN";
  if (cash + wh <= 0n) status = "OPEN";
  else if (cash + wh >= amt) status = "PAID";
  else status = "PARTIALLY_PAID";
  // Audit A: a collection change moves the SO money even when this billing's
  // own status does not change, so refresh the SO close state every time.
  let result = billing;
  if (status !== billing.status) {
    result = await tx.billing.update({ where: { id: billingId }, data: { status, updatedById: actorId } });
  }
  await refreshSalesOrderCloseState(tx, billing.salesOrderId, actorId);
  return result;
}

/** SO rollup: billed / remaining / collected / balance. */
export async function soBillingSummary(salesOrderId: string) {
  const so = await db.salesOrder.findUnique({ where: { id: salesOrderId }, select: { contractPrice: true } });
  if (!so) return null;
  const billings = await db.billing.findMany({
    where: { salesOrderId, status: { not: "VOID" } },
    include: {
      allocations: { where: { collection: { status: "POSTED" } } },
      // Audit D: return-credit applications count as cash collected.
      // Only POSTED returns count — a voided return un-applies its credit.
      creditApplications: { where: { customerCredit: { customerReturn: { status: "POSTED" } } } },
    },
  });
  const billed = billings.reduce((a, b) => a + toScaled(money(b.amount), 2), 0n);
  let cash = 0n;
  let wh = 0n;
  for (const b of billings) {
    for (const al of b.allocations) {
      cash += toScaled(money(al.cashApplied), 2);
      wh += toScaled(money(al.withholdingApplied), 2);
    }
    for (const ca of b.creditApplications) {
      cash += toScaled(money(String(ca.cashApplied)), 2);
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
