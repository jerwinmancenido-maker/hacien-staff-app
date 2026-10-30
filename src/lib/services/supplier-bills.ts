// Supplier bills (the supplier's invoice) recorded against a PO, for the 3-way
// match. Cost data: needs edit_data + "Can see costs". Bill numbers are unique
// per supplier among non-void bills (SupplierBill.activeKey).

import type { Prisma } from "@prisma/client";
import { db, isUniqueViolation } from "../db";
import { writeAudit } from "../audit";
import { dueDateFromTerms } from "../billing/dates";
import { DocRuleError, money, ymd } from "../documents/common";
import { fromScaled, lineAmounts, toScaled } from "../quotes/calc";
import { poActionError } from "../purchasing/status";
import type { BillInput } from "../validation/purchasing";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";
import { assertPoAccess, lockPurchaseOrder, type PoActor } from "./purchase-orders";

export const billKey = (supplierId: string, billNumber: string) => `${supplierId}:${billNumber.trim().toLowerCase()}`;

const QTY = /^\d{1,10}(\.\d{1,2})?$/;

/** Keep bill lines with a quantity; check numbers and that they're on the PO. */
export function billLines(input: BillInput["lines"], poLineIds: ReadonlySet<string>) {
  const out: { purchaseOrderItemId: string; qty: string; unitPrice: string; total: string }[] = [];
  for (const l of input) {
    const qty = l.qty.trim().replace(/,/g, "");
    const price = l.unitPrice.trim().replace(/,/g, "");
    if (!qty || toScaled(QTY.test(qty) ? qty : "0", 2) === 0n) {
      if (qty && !QTY.test(qty)) throw new DocRuleError("Bill line qty: enter a number with up to 2 decimals.", "lines");
      continue;
    }
    if (!QTY.test(price)) throw new DocRuleError("Bill line unit price: enter a number with up to 2 decimals.", "lines");
    if (!poLineIds.has(l.purchaseOrderItemId)) throw new DocRuleError("A bill line isn't on this PO.", "lines");
    const total = lineAmounts({ kind: "GOODS", qty, unitPrice: price, supplierUnitCost: "0" }).total;
    out.push({ purchaseOrderItemId: l.purchaseOrderItemId, qty: fromScaled(toScaled(qty, 2), 2), unitPrice: fromScaled(toScaled(price, 2), 2), total });
  }
  return out;
}

export async function recordSupplierBill(purchaseOrderId: string, input: BillInput, actor: PoActor, files: readonly UploadFile[] = []) {
  assertPoAccess(actor);
  const uploads = await prepareUploads(files);
  try {
    return await db.$transaction(async (tx) => {
      const po = await lockPurchaseOrder(tx, purchaseOrderId);
      const err = poActionError(po.status, "bill");
      if (err) throw new DocRuleError(err);
      const lines = billLines(input.lines, new Set(po.items.map((i) => i.id)));
      const dueDate = dueDateFromTerms(input.billDate, po.terms);
      const bill = await tx.supplierBill.create({
        data: {
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          billNumber: input.billNumber,
          activeKey: billKey(po.supplierId, input.billNumber),
          billDate: input.billDate,
          dueDate,
          amount: input.amount,
          notes: input.notes,
          createdById: actor.id,
          items: { create: lines },
        },
        include: { items: true },
      });
      await createAttachments(tx, uploads, { supplierBillId: bill.id }, actor.id);
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SupplierBill",
        entityId: bill.id,
        action: "create",
        after: {
          billNumber: bill.billNumber,
          purchaseOrder: po.number,
          billDate: ymd(bill.billDate),
          amount: money(bill.amount),
          items: lines.map((l) => ({ line: po.items.find((i) => i.id === l.purchaseOrderItemId)?.description, qty: l.qty, unitPrice: l.unitPrice })),
          attachments: uploads.length,
        },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "PurchaseOrder", entityId: po.id, action: "update", before: null, after: { billRecorded: bill.billNumber, amount: money(bill.amount) }, diff: false });
      return bill;
    });
  } catch (e) {
    await discardUploads(uploads);
    if (isUniqueViolation(e)) throw new DocRuleError("This supplier already has a bill with that number.", "billNumber");
    throw e;
  }
}

export async function voidSupplierBill(id: string, reason: string, actor: PoActor) {
  assertPoAccess(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`SupplierBill\` WHERE \`id\` = ${id} FOR UPDATE`;
    const before = await tx.supplierBill.findUnique({
      where: { id },
      include: {
        items: true,
        allocations: { where: { supplierPayment: { status: "POSTED" } } },
      },
    });
    if (!before) throw new DocRuleError("Bill not found.");
    if (before.status === "VOID") throw new DocRuleError("This bill is already void.");
    if (before.allocations.length) {
      throw new DocRuleError("This bill has posted supplier payments. Void those payments first.");
    }
    const now = new Date();
    const after = await tx.supplierBill.update({ where: { id }, data: { status: "VOID", voidedAt: now, voidReason: why, activeKey: null } });
    await tx.documentVoid.create({
      data: {
        docType: "SUPPLIER_BILL",
        docNumber: before.billNumber.slice(0, 40),
        docId: id,
        reason: why,
        snapshot: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        voidedById: actor.id,
        voidedAt: now,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SupplierBill",
      entityId: id,
      action: "void",
      before: { status: before.status },
      after: { status: "VOID", voidReason: why },
      diff: false,
    });
    return after;
  });
}
