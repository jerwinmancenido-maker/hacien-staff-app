// Quotes: create, edit, mark sent / lost, void, convert to sales order, email
// draft. Every function checks permissions itself (server-side), runs in one
// transaction with its audit row, and never deletes anything.

import type { Prisma, Quote, QuoteItem } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { addDays, manilaToday } from "../format";
import { assertCan, canSeeCosts, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { auditItems, DocRuleError, DOC_TX, money, withholdingCodes, withTxRetry, ymd } from "../documents/common";
import { docTotals, withholdingSnapshotFromLines } from "../quotes/calc";
import { itemData, planItems, type PlannedItem } from "../quotes/items";
import type { ConvertInput, ItemInput, QuoteInput } from "../validation/quotes";
import { suggestedDeliveryAddress } from "./addresses";
import { snapshotList } from "./withholding";

export type DocActor = PermissionUser & { id: string };

type QuoteWithItems = Quote & { items: QuoteItem[] };

export const EDITABLE_QUOTE_STATUSES = ["DRAFT", "SENT"] as const;

export function quoteAudit(q: QuoteWithItems) {
  return {
    number: q.number,
    status: q.status,
    customerId: q.customerId,
    contactId: q.contactId,
    date: ymd(q.date),
    validUntil: ymd(q.validUntil),
    terms: q.terms,
    notes: q.notes,
    withholding: withholdingCodes(snapshotList(q.withholding)),
    contractPrice: money(q.contractPrice),
    withholdingTotal: money(q.withholdingTotal),
    netReceived: money(q.netReceived),
    supplierCost: money(q.supplierCost),
    netMargin: money(q.netMargin),
    netMarginPct: money(q.netMarginPct),
    items: auditItems(q.items.filter((i) => !i.removedAt)),
  };
}

/** Money fields from per-line rates (round per line, then sum). */
function totalsData(items: PlannedItem[]) {
  const t = docTotals(items);
  return {
    contractPrice: t.contractPrice,
    withholdingTotal: t.withholdingTotal,
    netReceived: t.netReceived,
    supplierCost: t.supplierCost,
    netMargin: t.netMargin,
    netMarginPct: t.netMarginPct,
  };
}

/** Read-only document JSON summary derived from line rates (not a second rate source). */
function withholdingFromItems(items: PlannedItem[]) {
  return withholdingSnapshotFromLines(items);
}

async function lockQuote(tx: Tx, id: string): Promise<QuoteWithItems> {
  await tx.$queryRaw`SELECT \`id\` FROM \`Quote\` WHERE \`id\` = ${id} FOR UPDATE`;
  const q = await tx.quote.findUnique({ where: { id }, include: { items: { where: { removedAt: null } } } });
  if (!q) throw new DocRuleError("Quote not found.");
  return q;
}

async function checkCustomerAndContact(customerId: string, contactId: string | null, opts: { allowInactiveCustomerId?: string } = {}) {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer || (!customer.active && customer.id !== opts.allowInactiveCustomerId)) {
    throw new DocRuleError("Pick an active customer.", "customerId");
  }
  if (contactId) {
    const contact = await db.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.customerId !== customer.id || !contact.active) {
      throw new DocRuleError("Pick an active contact of this customer.", "contactId");
    }
  }
  return customer;
}

/** Suppliers on items must exist (only cost users can set them). */
export async function checkSuppliers(items: readonly Pick<ItemInput, "supplierId">[]) {
  const ids = [...new Set(items.map((i) => i.supplierId).filter((v): v is string => !!v))];
  if (!ids.length) return;
  const found = await db.supplier.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new DocRuleError("One of the suppliers no longer exists. Pick again.", "items");
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

export async function createQuote(input: QuoteInput, actor: DocActor): Promise<QuoteWithItems> {
  assertCan(actor, "edit_data");
  const withCosts = canSeeCosts(actor);
  const snap = await getSettingsSnapshot();
  const customer = await checkCustomerAndContact(input.customerId, input.contactId);
  if (withCosts) await checkSuppliers(input.items);

  // Line rates drive totals; document withholding JSON is a read-only summary.
  const { items } = planItems([], input.items, withCosts, {
    customerWithholdingType: customer.withholdingType,
    reapplyWithholding: input.reapplyWithholding === true,
  });
  const withholding = withholdingFromItems(items);
  const validUntil = input.validUntil ?? addDays(input.date, snap.settings.quotes.defaultValidityDays);
  const year = input.date.getUTCFullYear();
  const format = snap.settings.numbering.quote;

  await ensureSeries(db, "QUOTE", year, format);
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const number = await allocateDocNumber(tx, "QUOTE", year, format);
      const quote = await tx.quote.create({
        data: {
          number,
          customerId: customer.id,
          contactId: input.contactId,
          date: input.date,
          validUntil,
          terms: input.terms,
          notes: input.notes,
          settingsVersionId: snap.versionId,
          withholding: withholding as unknown as Prisma.InputJsonValue,
          ...totalsData(items),
          createdById: actor.id,
          updatedById: actor.id,
          items: { create: items.map(itemData) },
        },
        include: { items: true },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "Quote", entityId: quote.id, action: "create", after: quoteAudit(quote) });
      return quote;
    }, DOC_TX),
  );
}

export async function updateQuote(id: string, input: QuoteInput, actor: DocActor): Promise<QuoteWithItems> {
  assertCan(actor, "edit_data");
  const withCosts = canSeeCosts(actor);
  const current = await db.quote.findUnique({ where: { id } });
  if (!current) throw new DocRuleError("Quote not found.");
  const customer = await checkCustomerAndContact(input.customerId, input.contactId, { allowInactiveCustomerId: current.customerId });
  if (withCosts) await checkSuppliers(input.items);

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const before = await lockQuote(tx, id);
      if (!(EDITABLE_QUOTE_STATUSES as readonly string[]).includes(before.status)) {
        throw new DocRuleError("Only draft or sent quotes can be edited.");
      }
      const stored = before.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        supplierId: i.supplierId,
        supplierUnitCost: money(i.supplierUnitCost),
        withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
        withholdingAtc: i.withholdingAtc,
        withholdingOverride: i.withholdingOverride,
      }));
      const { items, removedIds } = planItems(stored, input.items, withCosts, {
        customerWithholdingType: customer.withholdingType,
        reapplyWithholding: input.reapplyWithholding === true,
      });
      const withholding = withholdingFromItems(items);

      if (removedIds.length) {
        await tx.quoteItem.updateMany({ where: { id: { in: removedIds }, quoteId: id }, data: { removedAt: new Date() } });
      }
      for (const item of items) {
        if (item.id) await tx.quoteItem.update({ where: { id: item.id }, data: itemData(item) });
        else await tx.quoteItem.create({ data: { ...itemData(item), quoteId: id } });
      }
      const after = await tx.quote.update({
        where: { id },
        data: {
          customerId: input.customerId,
          contactId: input.contactId,
          date: input.date,
          validUntil: input.validUntil ?? before.validUntil,
          terms: input.terms,
          notes: input.notes,
          withholding: withholding as unknown as Prisma.InputJsonValue,
          ...totalsData(items),
          updatedById: actor.id,
        },
        include: { items: { where: { removedAt: null } } },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "Quote", entityId: id, action: "update", before: quoteAudit(before), after: quoteAudit(after) });
      return after;
    }, DOC_TX),
  );
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

async function setStatus(id: string, actor: DocActor, from: readonly Quote["status"][], to: Quote["status"], message: string) {
  assertCan(actor, "edit_data");
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (!from.includes(before.status)) throw new DocRuleError(message);
    const after = await tx.quote.update({ where: { id }, data: { status: to, updatedById: actor.id }, include: { items: { where: { removedAt: null } } } });
    await writeAudit(tx, { userId: actor.id, entityType: "Quote", entityId: id, action: "update", before: { status: before.status }, after: { status: after.status } });
    return after;
  });
}

export function markQuoteSent(id: string, actor: DocActor) {
  return setStatus(id, actor, ["DRAFT"], "SENT", "Only a draft quote can be marked as sent.");
}

export function markQuoteLost(id: string, actor: DocActor) {
  return setStatus(id, actor, ["DRAFT", "SENT"], "LOST", "Only a draft or sent quote can be marked as lost.");
}

export async function voidQuote(id: string, reason: string, actor: DocActor) {
  assertCan(actor, "edit_data");
  if (!reason.trim()) throw new DocRuleError("A reason is required.", "reason");
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (before.status === "VOID") throw new DocRuleError("This quote is already void.");
    const activeSo = await tx.salesOrder.findFirst({ where: { quoteId: id, status: "OPEN" } });
    if (activeSo) throw new DocRuleError("Void the sales order first.");
    const now = new Date();
    const after = await tx.quote.update({
      where: { id },
      data: { status: "VOID", voidedAt: now, voidReason: reason.trim(), updatedById: actor.id },
      include: { items: { where: { removedAt: null } } },
    });
    await tx.documentVoid.create({
      data: {
        docType: "QUOTE",
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
      entityType: "Quote",
      entityId: id,
      action: "void",
      before: { status: before.status },
      after: { status: after.status, voidReason: after.voidReason },
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Convert to sales order
// ---------------------------------------------------------------------------

/**
 * Draft/Sent quote → Won, plus a new sales order (own SO number) copying the
 * header, items (with costs), withholding snapshot and settings version. One
 * transaction: if anything fails, neither the SO nor its number exists.
 */
export async function convertQuoteToSalesOrder(id: string, input: ConvertInput, actor: DocActor, opts: { date?: Date } = {}) {
  assertCan(actor, "edit_data");
  const snap = await getSettingsSnapshot();
  const date = opts.date ?? manilaToday();
  const year = date.getUTCFullYear();
  const format = snap.settings.numbering.salesOrder;
  await ensureSeries(db, "SALES_ORDER", year, format);

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const quote = await lockQuote(tx, id);
      if (quote.status === "VOID") throw new DocRuleError("A void quote can't be converted.");
      if (quote.status !== "DRAFT" && quote.status !== "SENT") {
        throw new DocRuleError("Only a draft or sent quote can be converted to a sales order.");
      }
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: quote.customerId } });
      const number = await allocateDocNumber(tx, "SALES_ORDER", year, format);
      const so = await tx.salesOrder.create({
        data: {
          number,
          quoteId: quote.id,
          customerId: quote.customerId,
          contactId: quote.contactId,
          date,
          buyerPoNo: input.buyerPoNo,
          buyerPoDate: input.buyerPoDate ?? null,
          // Snapshot of the text: later address edits don't change the SO.
          deliveryAddress: input.deliveryAddress ?? (await suggestedDeliveryAddress(customer, tx)),
          terms: quote.terms,
          notes: quote.notes,
          settingsVersionId: quote.settingsVersionId,
          withholding: quote.withholding as Prisma.InputJsonValue,
          contractPrice: quote.contractPrice,
          withholdingTotal: quote.withholdingTotal,
          netReceived: quote.netReceived,
          supplierCost: quote.supplierCost,
          netMargin: quote.netMargin,
          netMarginPct: quote.netMarginPct,
          createdById: actor.id,
          updatedById: actor.id,
          items: {
            create: [...quote.items]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((i) => ({
                sortOrder: i.sortOrder,
                description: i.description,
                kind: i.kind,
                qty: i.qty,
                unit: i.unit,
                supplierId: i.supplierId,
                supplierUnitCost: i.supplierUnitCost,
                unitPrice: i.unitPrice,
                total: i.total,
                supplierTotal: i.supplierTotal,
                margin: i.margin,
                // Copy line rates and ATCs exactly — never re-derive from the customer.
                withholdingRate: i.withholdingRate,
                withholdingAtc: i.withholdingAtc,
                withholdingOverride: i.withholdingOverride,
              })),
          },
        },
        include: { items: true },
      });
      await tx.quote.update({ where: { id }, data: { status: "WON", updatedById: actor.id } });
      await writeAudit(tx, { userId: actor.id, entityType: "Quote", entityId: id, action: "update", before: { status: quote.status }, after: { status: "WON", salesOrder: so.number } });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SalesOrder",
        entityId: so.id,
        action: "create",
        after: { number: so.number, fromQuote: quote.number, buyerPoNo: so.buyerPoNo, buyerPoDate: ymd(so.buyerPoDate), deliveryAddress: so.deliveryAddress, contractPrice: money(so.contractPrice) },
      });
      return so;
    }, DOC_TX),
  );
}

// ---------------------------------------------------------------------------
// Email draft (never sends)
// ---------------------------------------------------------------------------

export type EmailDraft = { to: string | null; toName: string | null; subject: string; body: string };

export async function buildQuoteEmailDraft(id: string, actor: DocActor): Promise<EmailDraft> {
  assertCan(actor, "edit_data");
  const quote = await db.quote.findUnique({ where: { id }, include: { customer: { include: { contacts: true } }, contact: true } });
  if (!quote) throw new DocRuleError("Quote not found.");
  if (quote.status === "VOID") throw new DocRuleError("A void quote can't be emailed.");
  const snap = await getSettingsSnapshot();
  const main = quote.customer.contacts.find((c) => c.isMain && c.active);
  const contact = quote.contact?.email ? quote.contact : main;
  const company = snap.settings.company.name;
  const greeting = contact?.name ? `Dear ${contact.name},` : "Good day,";
  const total = Number(quote.contractPrice).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const draft: EmailDraft = {
    to: contact?.email ?? null,
    toName: contact?.name ?? null,
    subject: `Quotation ${quote.number}`,
    body: [
      greeting,
      "",
      `Please find attached our quotation ${quote.number} for ${quote.customer.name}, with a total contract price of PHP ${total}.`,
      `It is valid until ${ymd(quote.validUntil)}.${quote.terms ? ` Terms: ${quote.terms}.` : ""}`,
      "",
      "[Attachment: save the quotation as PDF from Actions → Print / Save PDF and attach it before sending.]",
      "",
      "Thank you, and please let us know if you have any questions.",
      "",
      company,
    ].join("\n"),
  };
  await writeAudit(db, {
    userId: actor.id,
    entityType: "Quote",
    entityId: id,
    action: "email_draft",
    after: { to: draft.to, subject: draft.subject },
    diff: false,
  });
  return draft;
}
