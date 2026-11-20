// S-50: returns to supplier (RMA). Posting reduces the PO line's receivedQty
// and recomputes the PO status; voiding adds it back. Same row-lock pattern as
// receiving, so two returns at once can't over-return a line. The optional
// credit note is a reference only — it never changes bill or payment amounts.
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, assertCanVoid, type PermissionUser } from "../permissions";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { applyReceipt } from "../purchasing/receipt";
import { receiptStatus, type PoStatus } from "../purchasing/status";
import { checkReturn } from "../purchasing/returns";
import type { ReturnInput } from "../validation/purchasing";
import { voidReasonSchema } from "../validation/quotes";
import { assertPeriodOpen } from "./period-close";

export type ReturnActor = PermissionUser & { id: string };

const RETURNABLE: PoStatus[] = ["SENT", "PARTIALLY_RECEIVED", "RECEIVED"];
const RETURN_FORMAT = { prefix: "RMA", padding: 4, resetYearly: true };

type LockedLine = { id: string; description: string; qty: string; receivedQty: string };

async function lockForReturn(tx: Tx, purchaseOrderId: string): Promise<{ status: PoStatus; number: string; lines: LockedLine[] }> {
  const po = await tx.$queryRaw<{ id: string; status: PoStatus; number: string }[]>`SELECT \`id\`, \`status\`, \`number\` FROM \`PurchaseOrder\` WHERE \`id\` = ${purchaseOrderId} FOR UPDATE`;
  if (!po[0]) throw new DocRuleError("Purchase order not found.");
  const rows = await tx.$queryRaw<{ id: string; description: string; qty: unknown; receivedQty: unknown }[]>`SELECT \`id\`, \`description\`, \`qty\`, \`receivedQty\` FROM \`PurchaseOrderItem\` WHERE \`purchaseOrderId\` = ${purchaseOrderId} AND \`removedAt\` IS NULL ORDER BY \`sortOrder\` FOR UPDATE`;
  return {
    status: po[0].status,
    number: po[0].number,
    lines: rows.map((r) => ({ id: r.id, description: r.description, qty: money(String(r.qty)), receivedQty: money(String(r.receivedQty)) })),
  };
}

export async function postSupplierReturn(purchaseOrderId: string, input: ReturnInput, actor: ReturnActor) {
  assertCan(actor, "edit_data");
  const year = input.returnDate.getUTCFullYear();
  await ensureSeries(db, "SUPPLIER_RETURN", year, RETURN_FORMAT);
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const po = await lockForReturn(tx, purchaseOrderId);
      if (!RETURNABLE.includes(po.status)) throw new DocRuleError("Only a PO out for delivery can have returns.");
      await assertPeriodOpen(tx, input.returnDate);
      const check = checkReturn(po.lines, input.lines);
      if (!check.ok) throw new DocRuleError(check.message);
      const number = await allocateDocNumber(tx, "SUPPLIER_RETURN", year, RETURN_FORMAT);
      const ret = await tx.supplierReturn.create({
        data: {
          number,
          purchaseOrderId,
          returnDate: input.returnDate,
          reason: input.reason,
          creditNoteNumber: input.creditNoteNumber,
          creditNoteAmount: input.creditNoteAmount ?? undefined,
          createdById: actor.id,
          items: { create: check.entries.map((e) => ({ purchaseOrderItemId: e.lineId, qtyReturned: e.qty })) },
        },
        include: { items: true },
      });
      const byId = new Map(po.lines.map((l) => [l.id, l]));
      for (const e of check.entries) {
        const line = byId.get(e.lineId)!;
        line.receivedQty = applyReceipt(line, e.qty, -1);
        await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty } });
      }
      const next = receiptStatus(po.lines);
      if (next !== po.status) {
        await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: next, updatedById: actor.id } });
        await writeAudit(tx, { userId: actor.id, entityType: "PurchaseOrder", entityId: purchaseOrderId, action: "update", before: { status: po.status }, after: { status: next, reason: `Supplier return ${number}` }, diff: false });
      }
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SupplierReturn",
        entityId: ret.id,
        action: "create",
        after: {
          number,
          purchaseOrder: po.number,
          returnDate: ymd(input.returnDate),
          reason: input.reason,
          creditNoteNumber: input.creditNoteNumber,
          creditNoteAmount: input.creditNoteAmount,
          items: check.entries.map((e) => ({ line: byId.get(e.lineId)!.description, qty: e.qty })),
        },
      });
      return ret;
    }, DOC_TX),
  );
}

export async function voidSupplierReturn(id: string, reason: string, actor: ReturnActor) {
  assertCanVoid(actor);
  const parsed = voidReasonSchema.safeParse(reason);
  if (!parsed.success) throw new DocRuleError(parsed.error.issues[0]?.message ?? "Give a reason.");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const ret = await tx.supplierReturn.findUnique({ where: { id }, include: { items: true } });
      if (!ret) throw new DocRuleError("Return not found.");
      if (ret.status === "VOID") throw new DocRuleError("This return is already void.");
      const po = await lockForReturn(tx, ret.purchaseOrderId);
      await assertPeriodOpen(tx, ret.returnDate);
      const byId = new Map(po.lines.map((l) => [l.id, l]));
      for (const item of ret.items) {
        const line = byId.get(item.purchaseOrderItemId);
        if (!line) continue; // Line removed since; the return stays voided, quantities stay as-is.
        line.receivedQty = applyReceipt(line, money(String(item.qtyReturned)), 1);
        await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty } });
      }
      const next = receiptStatus(po.lines);
      await tx.supplierReturn.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidReason: parsed.data } });
      if (next !== po.status && RETURNABLE.includes(po.status)) {
        await tx.purchaseOrder.update({ where: { id: ret.purchaseOrderId }, data: { status: next, updatedById: actor.id } });
      }
      await writeAudit(tx, { userId: actor.id, entityType: "SupplierReturn", entityId: id, action: "void", after: { number: ret.number, reason: parsed.data } });
      return ret;
    }, DOC_TX),
  );
}

export async function listSupplierReturns(purchaseOrderId: string) {
  const rows = await db.supplierReturn.findMany({
    where: { purchaseOrderId },
    orderBy: [{ returnDate: "desc" }, { createdAt: "desc" }],
    include: { items: { include: { purchaseOrderItem: { select: { description: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    returnDate: ymd(r.returnDate)!,
    reason: r.reason,
    creditNoteNumber: r.creditNoteNumber,
    creditNoteAmount: r.creditNoteAmount === null ? null : money(String(r.creditNoteAmount)),
    voidReason: r.voidReason,
    items: r.items.map((i) => ({ description: i.purchaseOrderItem.description, qty: money(String(i.qtyReturned)) })),
  }));
}

export type SupplierReturnView = Awaited<ReturnType<typeof listSupplierReturns>>[number];
