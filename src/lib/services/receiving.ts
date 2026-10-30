// Receiving reports (RR-YYYY-####): quantities only, no prices, so staff
// without cost access can receive goods. Posting and voiding lock the PO row and
// its lines (SELECT … FOR UPDATE) in the same transaction that changes
// receivedQty, so two receipts at once can't over-receive a line: the second
// waits, then sees the first one's quantities and is rejected.

import type { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { applyReceipt, checkReceipt, type OpenLine } from "../purchasing/receipt";
import { poActionError, receiptStatus, type PoStatus } from "../purchasing/status";
import type { ReceiptInput } from "../validation/purchasing";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";

export type RrActor = PermissionUser & { id: string };

/** Thrown when quantities fail the over-receive check; `lineErrors` is keyed by PO line id. */
export class ReceiptError extends DocRuleError {
  constructor(
    message: string,
    public lineErrors: Record<string, string>,
  ) {
    super(message);
    this.name = "ReceiptError";
  }
}

type LockedLine = { id: string; description: string; qty: string; receivedQty: string };

/** Lock the PO row, then its live lines, and read the current quantities from the locking read. */
async function lockForReceiving(tx: Tx, purchaseOrderId: string): Promise<{ status: PoStatus; number: string; lines: LockedLine[] }> {
  const po = await tx.$queryRaw<{ id: string; status: PoStatus; number: string }[]>`SELECT \`id\`, \`status\`, \`number\` FROM \`PurchaseOrder\` WHERE \`id\` = ${purchaseOrderId} FOR UPDATE`;
  if (!po[0]) throw new DocRuleError("Purchase order not found.");
  const rows = await tx.$queryRaw<{ id: string; description: string; qty: unknown; receivedQty: unknown }[]>`SELECT \`id\`, \`description\`, \`qty\`, \`receivedQty\` FROM \`PurchaseOrderItem\` WHERE \`purchaseOrderId\` = ${purchaseOrderId} AND \`removedAt\` IS NULL ORDER BY \`sortOrder\` FOR UPDATE`;
  return {
    status: po[0].status,
    number: po[0].number,
    lines: rows.map((r) => ({ id: r.id, description: r.description, qty: money(String(r.qty)), receivedQty: money(String(r.receivedQty)) })),
  };
}

async function setPoStatus(tx: Tx, purchaseOrderId: string, from: PoStatus, to: PoStatus, actorId: string, reason: string) {
  if (from === to) return;
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: to, updatedById: actorId } });
  await writeAudit(tx, { userId: actorId, entityType: "PurchaseOrder", entityId: purchaseOrderId, action: "update", before: { status: from }, after: { status: to, reason }, diff: false });
}

export async function postReceivingReport(purchaseOrderId: string, input: ReceiptInput, actor: RrActor, files: readonly UploadFile[] = []) {
  assertCan(actor, "edit_data");
  const receiver = await db.user.findUnique({ where: { id: input.receivedById } });
  if (!receiver || !receiver.active) throw new DocRuleError("Pick an active user as the receiver.", "receivedById");
  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.receivingReport;
  const year = input.receivedDate.getUTCFullYear();
  await ensureSeries(db, "RECEIVING_REPORT", year, format);
  const uploads = await prepareUploads(files);
  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const po = await lockForReceiving(tx, purchaseOrderId);
        const err = poActionError(po.status, "receive");
        if (err) throw new DocRuleError(err);
        const check = checkReceipt(po.lines as OpenLine[], input.lines);
        if (!check.ok) throw new ReceiptError(check.message, check.errors);
        const number = await allocateDocNumber(tx, "RECEIVING_REPORT", year, format);
        const rr = await tx.receivingReport.create({
          data: {
            number,
            purchaseOrderId,
            receivedDate: input.receivedDate,
            receivedById: receiver.id,
            deliveryRef: input.deliveryRef,
            notes: input.notes,
            createdById: actor.id,
            items: { create: check.entries.map((e) => ({ purchaseOrderItemId: e.lineId, qtyReceived: e.qty })) },
          },
          include: { items: true },
        });
        const byId = new Map(po.lines.map((l) => [l.id, l]));
        for (const e of check.entries) {
          const line = byId.get(e.lineId)!;
          line.receivedQty = applyReceipt(line, e.qty, 1);
          await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty } });
        }
        await createAttachments(tx, uploads, { receivingReportId: rr.id }, actor.id);
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "ReceivingReport",
          entityId: rr.id,
          action: "create",
          after: {
            number,
            purchaseOrder: po.number,
            receivedDate: ymd(input.receivedDate),
            receivedById: receiver.id,
            deliveryRef: input.deliveryRef,
            items: check.entries.map((e) => ({ line: byId.get(e.lineId)!.description, qty: e.qty })),
            attachments: uploads.length,
          },
        });
        await setPoStatus(tx, purchaseOrderId, po.status, receiptStatus(po.lines), actor.id, `Receiving report ${number}`);
        return rr;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    throw e;
  }
}

/** Void a posted RR (reason): reverses its quantities and recomputes the PO status. Not on a closed or void PO. */
export async function voidReceivingReport(id: string, reason: string, actor: RrActor) {
  assertCan(actor, "edit_data");
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");
  const head = await db.receivingReport.findUnique({ where: { id }, select: { purchaseOrderId: true } });
  if (!head) throw new DocRuleError("Receiving report not found.");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const po = await lockForReceiving(tx, head.purchaseOrderId);
      await tx.$queryRaw`SELECT \`id\` FROM \`ReceivingReport\` WHERE \`id\` = ${id} FOR UPDATE`;
      const rr = await tx.receivingReport.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (rr.status === "VOID") throw new DocRuleError("This receiving report is already void.");
      if (!["SENT", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status)) {
        throw new DocRuleError(po.status === "CLOSED" ? "The PO is closed; its receiving reports can't be voided." : "The PO is void.");
      }
      const byId = new Map(po.lines.map((l) => [l.id, l]));
      for (const item of rr.items) {
        const line = byId.get(item.purchaseOrderItemId);
        if (!line) throw new DocRuleError("A line of this receiving report was removed from the PO.");
        line.receivedQty = applyReceipt(line, money(item.qtyReceived), -1);
        await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty } });
      }
      const now = new Date();
      const after = await tx.receivingReport.update({ where: { id }, data: { status: "VOID", voidedAt: now, voidReason: why } });
      await tx.documentVoid.create({
        data: {
          docType: "RECEIVING_REPORT",
          docNumber: rr.number,
          docId: id,
          reason: why,
          snapshot: JSON.parse(JSON.stringify(rr)) as Prisma.InputJsonValue,
          voidedById: actor.id,
          voidedAt: now,
        },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "ReceivingReport", entityId: id, action: "void", before: { status: "POSTED" }, after: { status: "VOID", voidReason: why }, diff: false });
      await setPoStatus(tx, head.purchaseOrderId, po.status, receiptStatus(po.lines), actor.id, `Receiving report ${rr.number} voided`);
      return after;
    }, DOC_TX),
  );
}
