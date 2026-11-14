// Admin delete of documents that never had legal effect: draft or void quotes,
// and void sales orders, billings, and collections. The only hard-delete path
// in the app. Each delete runs inside the delete allowance gate for its own
// models; the Prisma extension allows Prisma delete of those models only
// until the call returns. The audit snapshot is stored on the audit row's
// `before`.

import { PrismaClient } from "@prisma/client";
import { writeAudit } from "../audit";
import { db, isForeignKeyViolation, type Tx } from "../db";
import { DELETE_ALLOWANCE_KEY } from "../delete-allowance-key";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { assertNotDelete, deleteAllowanceGate, HardDeleteError, noDeleteExtension } from "../no-delete";
import { assertCanDeleteDocument, type PermissionUser } from "../permissions";
import { voidReasonSchema } from "../validation/quotes";
import { assertPeriodOpen } from "./period-close";

/** The gate's run method, reachable only via DELETE_ALLOWANCE_KEY. */
const withDeleteAllowance = deleteAllowanceGate[DELETE_ALLOWANCE_KEY];

export type DeleteActor = PermissionUser & { id: string };

const QUOTE_MODELS = ["Quote", "QuoteItem", "QuoteItemComponent"] as const;
const SO_MODELS = ["SalesOrder", "SalesOrderItem", "SalesOrderItemComponent"] as const;
const BILLING_MODELS = ["Billing"] as const;
const COLLECTION_MODELS = ["Collection"] as const;

let armedFailure = false;

/**
 * Test hook. The next delete throws after the audit row and child deletes,
 * before the parent row is removed, so the transaction rolls back.
 */
export function armDocumentDeleteFailure(): void {
  armedFailure = true;
}

function consumeArmedFailure(): void {
  if (!armedFailure) return;
  armedFailure = false;
  throw new Error("forced document delete failure");
}

/** A concurrent insert that trips the FK (P2003) is a plain refusal, not a Prisma error. */
export function plainDeleteRefusal(e: unknown): DocRuleError | null {
  if (isForeignKeyViolation(e)) {
    return new DocRuleError("This document is linked to other records and can't be deleted.");
  }
  return null;
}

function requireReason(reason: string): string {
  const parsed = voidReasonSchema.safeParse(reason);
  if (!parsed.success) {
    throw new DocRuleError(parsed.error.issues[0]?.message ?? "A reason is required.", "reason");
  }
  return parsed.data;
}

async function runDelete<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withTxRetry(() => db.$transaction(fn, DOC_TX));
  } catch (e) {
    const refusal = plainDeleteRefusal(e);
    if (refusal) throw refusal;
    throw e;
  } finally {
    armedFailure = false;
  }
}

async function lockQuote(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT \`id\` FROM \`Quote\` WHERE \`id\` = ${id} FOR UPDATE`;
}

async function lockSalesOrder(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT \`id\` FROM \`SalesOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
}

async function lockBilling(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT \`id\` FROM \`Billing\` WHERE \`id\` = ${id} FOR UPDATE`;
}

async function lockCollection(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT \`id\` FROM \`Collection\` WHERE \`id\` = ${id} FOR UPDATE`;
}

async function markRemindersDone(tx: Tx, entityType: "QUOTE" | "SALES_ORDER", entityId: string) {
  await tx.reminder.updateMany({
    where: { entityType, entityId, doneAt: null },
    data: { doneAt: new Date() },
  });
}

const ATTACHMENT = "This document has an attachment, so it can't be deleted.";
const TAX = "This document has a withholding (2307) record, so it can't be deleted.";

export async function deleteQuote(id: string, reason: string, actor: DeleteActor) {
  assertCanDeleteDocument(actor);
  const why = requireReason(reason);
  return runDelete(async (tx) => {
    await lockQuote(tx, id);
    const quote = await tx.quote.findUnique({
      where: { id },
      include: { customer: { select: { name: true } } },
    });
    if (!quote) throw new DocRuleError("Quote not found.");
    if (quote.status !== "DRAFT" && quote.status !== "VOID") {
      throw new DocRuleError("Only a draft or void quote can be deleted.");
    }
    // Any sales order, in any status, blocks the delete.
    const salesOrders = await tx.salesOrder.count({ where: { quoteId: id } });
    if (salesOrders > 0) throw new DocRuleError("This quote has a sales order, so it can't be deleted.");
    const attachments = await tx.documentAttachment.count({ where: { quoteId: id } });
    if (attachments > 0) throw new DocRuleError(ATTACHMENT);

    await markRemindersDone(tx, "QUOTE", id);
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Quote",
      entityId: id,
      action: "delete",
      before: {
        number: quote.number,
        reason: why,
        customer: quote.customer.name,
        total: money(quote.contractPrice),
        status: quote.status,
      },
      after: null,
      diff: false,
    });

    const items = await tx.quoteItem.findMany({ where: { quoteId: id }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    const components = itemIds.length
      ? await tx.quoteItemComponent.findMany({ where: { quoteItemId: { in: itemIds } }, select: { id: true } })
      : [];

    await withDeleteAllowance(QUOTE_MODELS, async () => {
      for (const c of components) await tx.quoteItemComponent.delete({ where: { id: c.id } });
      for (const item of items) await tx.quoteItem.delete({ where: { id: item.id } });
      consumeArmedFailure();
      await tx.quote.delete({ where: { id } });
    });
    return { id, number: quote.number, customerId: quote.customerId };
  });
}

export async function deleteSalesOrder(id: string, reason: string, actor: DeleteActor) {
  assertCanDeleteDocument(actor);
  const why = requireReason(reason);
  return runDelete(async (tx) => {
    const peek = await tx.salesOrder.findUnique({ where: { id }, select: { quoteId: true } });
    if (!peek) throw new DocRuleError("Sales order not found.");
    await lockQuote(tx, peek.quoteId);
    await lockSalesOrder(tx, id);

    const so = await tx.salesOrder.findUnique({
      where: { id },
      include: { customer: { select: { name: true } } },
    });
    if (!so) throw new DocRuleError("Sales order not found.");
    if (so.status !== "VOID") throw new DocRuleError("Only a void sales order can be deleted.");
    await assertPeriodOpen(tx, so.date);

    const billings = await tx.billing.count({ where: { salesOrderId: id } });
    if (billings > 0) throw new DocRuleError("This sales order has a billing. Delete the billing first.");
    const texts = await tx.orderTextSent.count({ where: { salesOrderId: id } });
    if (texts > 0) throw new DocRuleError("This sales order has an order text on record, so it can't be deleted.");
    const purchaseOrders = await tx.purchaseOrder.count({ where: { salesOrderId: id } });
    if (purchaseOrders > 0) throw new DocRuleError("This sales order has a purchase order, so it can't be deleted.");
    const returns = await tx.customerReturn.count({ where: { salesOrderId: id } });
    if (returns > 0) throw new DocRuleError("This sales order has a customer return, so it can't be deleted.");
    const deliveries = await tx.delivery.count({ where: { salesOrderId: id } });
    if (deliveries > 0) throw new DocRuleError("This sales order has a delivery, so it can't be deleted.");
    // REQ-ATTACH-001 (plan amendment (a)): count only NON-archived files.
    // Deliberately unlike the quote/billing/collection counts above, which
    // include archived files: here, archiving a file (the Admin "remove")
    // is what frees the order for deletion. Do not "align" this with the
    // other counts — the divergence is the approved behaviour.
    const attachments = await tx.documentAttachment.count({ where: { salesOrderId: id, archivedAt: null } });
    if (attachments > 0) throw new DocRuleError(ATTACHMENT);

    const items = await tx.salesOrderItem.findMany({ where: { salesOrderId: id }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    const components = itemIds.length
      ? await tx.salesOrderItemComponent.findMany({ where: { salesOrderItemId: { in: itemIds } }, select: { id: true } })
      : [];
    const componentIds = components.map((c) => c.id);
    if (itemIds.length || componentIds.length) {
      const poLines = await tx.purchaseOrderItem.count({
        where: {
          OR: [
            ...(itemIds.length ? [{ salesOrderItemId: { in: itemIds } }] : []),
            ...(componentIds.length ? [{ salesOrderItemComponentId: { in: componentIds } }] : []),
          ],
        },
      });
      if (poLines > 0) throw new DocRuleError("This sales order has a purchase order, so it can't be deleted.");
      if (itemIds.length) {
        const returnLines = await tx.customerReturnItem.count({ where: { salesOrderItemId: { in: itemIds } } });
        if (returnLines > 0) throw new DocRuleError("This sales order has a customer return, so it can't be deleted.");
        const deliveryLines = await tx.deliveryItem.count({ where: { salesOrderItemId: { in: itemIds } } });
        if (deliveryLines > 0) throw new DocRuleError("This sales order has a delivery, so it can't be deleted.");
      }
    }

    await markRemindersDone(tx, "SALES_ORDER", id);
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SalesOrder",
      entityId: id,
      action: "delete",
      before: {
        number: so.number,
        reason: why,
        customer: so.customer.name,
        total: money(so.contractPrice),
        status: so.status,
      },
      after: null,
      diff: false,
    });

    await withDeleteAllowance(SO_MODELS, async () => {
      for (const c of components) await tx.salesOrderItemComponent.delete({ where: { id: c.id } });
      for (const item of items) await tx.salesOrderItem.delete({ where: { id: item.id } });
      consumeArmedFailure();
      await tx.salesOrder.delete({ where: { id } });
    });
    return { id, number: so.number, customerId: so.customerId, quoteId: so.quoteId };
  });
}

export async function deleteBilling(id: string, reason: string, actor: DeleteActor) {
  assertCanDeleteDocument(actor);
  const why = requireReason(reason);
  return runDelete(async (tx) => {
    const peek = await tx.billing.findUnique({
      where: { id },
      select: { salesOrderId: true, salesOrder: { select: { quoteId: true } } },
    });
    if (!peek) throw new DocRuleError("Billing not found.");
    await lockQuote(tx, peek.salesOrder.quoteId);
    await lockSalesOrder(tx, peek.salesOrderId);
    await lockBilling(tx, id);

    const billing = await tx.billing.findUnique({
      where: { id },
      include: { customer: { select: { name: true } } },
    });
    if (!billing) throw new DocRuleError("Billing not found.");
    if (billing.status !== "VOID") throw new DocRuleError("Only a void billing can be deleted.");
    await assertPeriodOpen(tx, billing.invoiceDate);

    // Any allocation, including one left behind by a void collection.
    const allocations = await tx.collectionAllocation.count({ where: { billingId: id } });
    if (allocations > 0) throw new DocRuleError("This billing has a payment allocation, so it can't be deleted.");
    const taxes = await tx.withholding2307.count({ where: { billingId: id } });
    if (taxes > 0) throw new DocRuleError(TAX);
    const attachments = await tx.documentAttachment.count({ where: { billingId: id } });
    if (attachments > 0) throw new DocRuleError(ATTACHMENT);
    const credits = await tx.customerCreditApplication.count({ where: { billingId: id } });
    if (credits > 0) throw new DocRuleError("This billing has return credit applied, so it can't be deleted.");

    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Billing",
      entityId: id,
      action: "delete",
      before: {
        number: billing.number,
        reason: why,
        customer: billing.customer.name,
        total: money(billing.amount),
        invoiceNo: billing.invoiceNo,
        invoiceDate: ymd(billing.invoiceDate),
        status: billing.status,
        withholdingExpected: money(billing.withholdingExpected),
        netExpected: money(billing.netExpected),
      },
      after: null,
      diff: false,
    });

    await withDeleteAllowance(BILLING_MODELS, async () => {
      consumeArmedFailure();
      await tx.billing.delete({ where: { id } });
    });
    return { id, number: billing.number, invoiceNo: billing.invoiceNo, customerId: billing.customerId, salesOrderId: billing.salesOrderId };
  });
}

async function lockCollectionParents(tx: Tx, collectionId: string) {
  const allocs = await tx.collectionAllocation.findMany({
    where: { collectionId },
    select: { billingId: true },
  });
  const billingIds = [...new Set(allocs.map((a) => a.billingId))].sort();
  const parents: { quoteId: string; salesOrderId: string; billingId: string }[] = [];
  for (const billingId of billingIds) {
    const billing = await tx.billing.findUnique({
      where: { id: billingId },
      select: { salesOrderId: true, salesOrder: { select: { quoteId: true } } },
    });
    if (billing) parents.push({ billingId, salesOrderId: billing.salesOrderId, quoteId: billing.salesOrder.quoteId });
  }
  const seenQ = new Set<string>();
  const seenS = new Set<string>();
  const seenB = new Set<string>();
  for (const p of parents) {
    if (seenQ.has(p.quoteId)) continue;
    seenQ.add(p.quoteId);
    await lockQuote(tx, p.quoteId);
  }
  for (const p of parents) {
    if (seenS.has(p.salesOrderId)) continue;
    seenS.add(p.salesOrderId);
    await lockSalesOrder(tx, p.salesOrderId);
  }
  for (const p of parents) {
    if (seenB.has(p.billingId)) continue;
    seenB.add(p.billingId);
    await lockBilling(tx, p.billingId);
  }
  await lockCollection(tx, collectionId);
}

export async function deleteCollection(id: string, reason: string, actor: DeleteActor) {
  assertCanDeleteDocument(actor);
  const why = requireReason(reason);
  return runDelete(async (tx) => {
    const exists = await tx.collection.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new DocRuleError("Collection not found.");
    await lockCollectionParents(tx, id);

    const collection = await tx.collection.findUnique({
      where: { id },
      include: { customer: { select: { name: true } } },
    });
    if (!collection) throw new DocRuleError("Collection not found.");
    if (collection.status !== "VOID") throw new DocRuleError("Only a void collection can be deleted.");
    await assertPeriodOpen(tx, collection.date);
    if (collection.receiptNo && collection.receiptNo.trim()) {
      throw new DocRuleError("This collection has an official receipt number, so it can't be deleted.");
    }
    const allocations = await tx.collectionAllocation.count({ where: { collectionId: id } });
    if (allocations > 0) throw new DocRuleError("This collection has a payment allocation, so it can't be deleted.");
    const taxes = await tx.withholding2307.count({ where: { collectionId: id } });
    if (taxes > 0) throw new DocRuleError(TAX);
    const attachments = await tx.documentAttachment.count({ where: { collectionId: id } });
    if (attachments > 0) throw new DocRuleError(ATTACHMENT);

    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Collection",
      entityId: id,
      action: "delete",
      before: {
        number: collection.number,
        reason: why,
        customer: collection.customer.name,
        total: money(collection.amountReceived),
        status: collection.status,
        date: ymd(collection.date),
        receiptNo: collection.receiptNo,
      },
      after: null,
      diff: false,
    });

    await withDeleteAllowance(COLLECTION_MODELS, async () => {
      consumeArmedFailure();
      await tx.collection.delete({ where: { id } });
    });
    return { id, number: collection.number, customerId: collection.customerId };
  });
}

/**
 * Page predicates: would deleteBilling refuse this (void) billing on its
 * link guards alone? Mirrors the counts inside deleteBilling exactly —
 * allocations from ANY collection (void ones included), 2307 rows,
 * attachments INCLUDING archived, and return-credit applications — so the
 * billing page can show "Kept for BIR records" instead of a Delete button
 * that would only be refused. Status/role checks stay with the callers.
 */
export async function billingDeleteBlocked(id: string): Promise<boolean> {
  const [allocations, taxes, attachments, credits] = await Promise.all([
    db.collectionAllocation.count({ where: { billingId: id } }),
    db.withholding2307.count({ where: { billingId: id } }),
    db.documentAttachment.count({ where: { billingId: id } }),
    db.customerCreditApplication.count({ where: { billingId: id } }),
  ]);
  return allocations > 0 || taxes > 0 || attachments > 0 || credits > 0;
}

/**
 * Page predicate matching deleteCollection's guards: an official receipt
 * number, allocations, 2307 rows, or attachments INCLUDING archived each
 * keep the collection for BIR records.
 */
export async function collectionDeleteBlocked(c: {
  id: string;
  receiptNo: string | null;
}): Promise<boolean> {
  if (c.receiptNo && c.receiptNo.trim()) return true;
  const [allocations, taxes, attachments] = await Promise.all([
    db.collectionAllocation.count({ where: { collectionId: c.id } }),
    db.withholding2307.count({ where: { collectionId: c.id } }),
    db.documentAttachment.count({ where: { collectionId: c.id } }),
  ]);
  return allocations > 0 || taxes > 0 || attachments > 0;
}

type ProbeClient = { user: { delete: (args: { where: { id: string } }) => Promise<unknown> } };

/**
 * Guard probe for tests/no-delete.test.ts. Enters the private allowance and
 * proves a nested delete of a different model is still blocked. Uses an
 * unreachable database so it cannot remove a real row.
 */
export async function proveNestedDifferentModelDeleteBlocked(): Promise<{
  quoteBlockedOutside: boolean;
  quoteAllowedInside: boolean;
  otherBlockedInside: boolean;
  nestedOtherBlocked: boolean;
  deleteManyBlockedInside: boolean;
}> {
  const client = new PrismaClient({ datasourceUrl: "mysql://nobody:nothing@127.0.0.1:1/none" }).$extends(noDeleteExtension);
  try {
    let outside: unknown = null;
    try {
      await client.quote.delete({ where: { id: "x" } });
    } catch (e) {
      outside = e;
    }
    const inside = await withDeleteAllowance(QUOTE_MODELS, async () => {
      let quoteError: unknown = null;
      try {
        await client.quote.delete({ where: { id: "x" } });
      } catch (e) {
        quoteError = e;
      }
      let other: unknown = null;
      try {
        await client.customer.delete({ where: { id: "x" } });
      } catch (e) {
        other = e;
      }
      let nested: unknown = null;
      try {
        await deleteDifferentModel(client);
      } catch (e) {
        nested = e;
      }
      let many: unknown = null;
      try {
        assertNotDelete("Quote", "deleteMany");
      } catch (e) {
        many = e;
      }
      return {
        quoteAllowedInside: !(quoteError instanceof HardDeleteError),
        otherBlockedInside: other instanceof HardDeleteError,
        nestedOtherBlocked: nested instanceof HardDeleteError,
        deleteManyBlockedInside: many instanceof HardDeleteError,
      };
    });
    return { quoteBlockedOutside: outside instanceof HardDeleteError, ...inside };
  } finally {
    await client.$disconnect();
  }
}

async function deleteDifferentModel(client: ProbeClient): Promise<void> {
  await client.user.delete({ where: { id: "nested" } });
}
