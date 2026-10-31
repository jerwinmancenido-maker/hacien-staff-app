// Sales orders: created only by converting a quote (see quotes.ts). Open SOs can
// be edited by Staff+ (audited); voiding returns the quote to Sent.

import type { Prisma, SalesOrder, SalesOrderItem } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, canSeeCosts } from "../permissions";
import { auditItems, DocRuleError, DOC_TX, money, withholdingCodes, withTxRetry, ymd } from "../documents/common";
import { itemData, planItems } from "../quotes/items";
import { preserveLegacyWithholdingOnSave } from "../quotes/legacy-withholding";
import type { SalesOrderInput } from "../validation/quotes";
import { checkSuppliers, type DocActor } from "./quotes";
import { snapshotList } from "./withholding";

type SoWithItems = SalesOrder & { items: SalesOrderItem[] };

export function salesOrderAudit(so: SoWithItems) {
  return {
    number: so.number,
    status: so.status,
    contactId: so.contactId,
    buyerPoNo: so.buyerPoNo,
    buyerPoDate: ymd(so.buyerPoDate),
    deliveryAddress: so.deliveryAddress,
    terms: so.terms,
    notes: so.notes,
    withholding: withholdingCodes(snapshotList(so.withholding)),
    contractPrice: money(so.contractPrice),
    withholdingTotal: money(so.withholdingTotal),
    netReceived: money(so.netReceived),
    supplierCost: money(so.supplierCost),
    netMargin: money(so.netMargin),
    netMarginPct: money(so.netMarginPct),
    items: auditItems(so.items.filter((i) => !i.removedAt)),
  };
}

async function lockSalesOrder(tx: Tx, id: string): Promise<SoWithItems> {
  await tx.$queryRaw`SELECT \`id\` FROM \`SalesOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
  const so = await tx.salesOrder.findUnique({ where: { id }, include: { items: { where: { removedAt: null } } } });
  if (!so) throw new DocRuleError("Sales order not found.");
  return so;
}

export async function updateSalesOrder(id: string, input: SalesOrderInput, actor: DocActor): Promise<SoWithItems> {
  assertCan(actor, "edit_data");
  const withCosts = canSeeCosts(actor);
  if (withCosts) await checkSuppliers(input.items);

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const before = await lockSalesOrder(tx, id);
      if (before.status !== "OPEN") throw new DocRuleError("Only an open sales order can be edited.");
      if (input.contactId) {
        const contact = await tx.contact.findUnique({ where: { id: input.contactId } });
        if (!contact || contact.customerId !== before.customerId || !contact.active) {
          throw new DocRuleError("Pick an active contact of this customer.", "contactId");
        }
      }
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: before.customerId } });
      const stored = before.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        supplierId: i.supplierId,
        supplierUnitCost: money(i.supplierUnitCost),
        withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
        withholdingAtc: i.withholdingAtc,
        withholdingOverride: i.withholdingOverride,
      }));
      const { items: planned, removedIds } = planItems(stored, input.items, withCosts, {
        customerWithholdingType: customer.withholdingType,
        reapplyWithholding: input.reapplyWithholding === true,
      });
      // Legacy NULL line rates must not recompute stored WH to ₱0 on save.
      const preserved = preserveLegacyWithholdingOnSave(before, planned);
      if (!preserved.ok) throw new DocRuleError(preserved.message);
      const items = preserved.items;
      if (removedIds.length) {
        await tx.salesOrderItem.updateMany({ where: { id: { in: removedIds }, salesOrderId: id }, data: { removedAt: new Date() } });
      }
      for (const item of items) {
        if (item.id) await tx.salesOrderItem.update({ where: { id: item.id }, data: itemData(item) });
        else await tx.salesOrderItem.create({ data: { ...itemData(item), salesOrderId: id } });
      }
      const after = await tx.salesOrder.update({
        where: { id },
        data: {
          contactId: input.contactId,
          buyerPoNo: input.buyerPoNo,
          buyerPoDate: input.buyerPoDate ?? null,
          deliveryAddress: input.deliveryAddress,
          terms: input.terms,
          notes: input.notes,
          withholding: preserved.withholding as unknown as Prisma.InputJsonValue,
          ...preserved.totals,
          updatedById: actor.id,
        },
        include: { items: { where: { removedAt: null } } },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "SalesOrder", entityId: id, action: "update", before: salesOrderAudit(before), after: salesOrderAudit(after) });
      return after;
    }, DOC_TX),
  );
}

/** Void an open SO (reason required). Its quote goes back to Sent so it can be converted again. */
export async function voidSalesOrder(id: string, reason: string, actor: DocActor) {
  assertCan(actor, "edit_data");
  if (!reason.trim()) throw new DocRuleError("A reason is required.", "reason");
  return db.$transaction(async (tx) => {
    const before = await lockSalesOrder(tx, id);
    if (before.status === "VOID") throw new DocRuleError("This sales order is already void.");
    await tx.$queryRaw`SELECT \`id\` FROM \`Quote\` WHERE \`id\` = ${before.quoteId} FOR UPDATE`;
    const now = new Date();
    const after = await tx.salesOrder.update({ where: { id }, data: { status: "VOID", voidedAt: now, voidReason: reason.trim(), updatedById: actor.id } });
    await tx.documentVoid.create({
      data: {
        docType: "SALES_ORDER",
        docNumber: before.number,
        docId: id,
        reason: reason.trim(),
        snapshot: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        voidedById: actor.id,
        voidedAt: now,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SalesOrder",
      entityId: id,
      action: "void",
      before: { status: before.status },
      after: { status: after.status, voidReason: after.voidReason },
    });

    const quote = await tx.quote.findUniqueOrThrow({ where: { id: before.quoteId } });
    const otherOpen = await tx.salesOrder.count({ where: { quoteId: quote.id, status: "OPEN" } });
    if (quote.status === "WON" && otherOpen === 0) {
      await tx.quote.update({ where: { id: quote.id }, data: { status: "SENT", updatedById: actor.id } });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "update",
        before: { status: "WON" },
        after: { status: "SENT", reason: `Sales order ${before.number} voided` },
      });
    }
    return after;
  });
}
