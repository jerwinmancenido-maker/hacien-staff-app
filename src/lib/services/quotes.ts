// Quotes: create, edit, mark sent / lost, void, convert to sales order, email
// draft. Every function checks permissions itself (server-side), runs in one
// transaction with its audit row, and never deletes anything.

import { Prisma, type Quote, type QuoteItem } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { addDays, manilaToday } from "../format";
import { assertCan, canSeeCosts, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { auditItems, DocRuleError, DOC_TX, money, withholdingCodes, withTxRetry, ymd } from "../documents/common";
import { docTotals, withholdingSnapshotFromLines, type WithholdingSnapshot } from "../quotes/calc";
import { itemData, planItems, type PlannedItem } from "../quotes/items";
import { preserveLegacyWithholdingOnSave } from "../quotes/legacy-withholding";
import { parseWithholdingPick } from "../quotes/withholding-defaults";
import type { ConvertInput, ItemInput, QuoteInput } from "../validation/quotes";
import { suggestedDeliveryAddress } from "./addresses";
import { buildWithholdingSnapshot, listWithholdingRates, snapshotList } from "./withholding";

export type DocActor = PermissionUser & { id: string };

type QuoteWithItems = Quote & { items: QuoteItem[] };

export const EDITABLE_QUOTE_STATUSES = ["DRAFT", "SENT"] as const;

/** Draft / unsent only — sent and later statuses keep a frozen company snapshot. */
export function quoteCanRefreshCompanyDetails(status: Quote["status"]): boolean {
  return status === "DRAFT";
}

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
    internalNotes: q.internalNotes,
    subject: q.subject,
    buyerPoNo: q.buyerPoNo,
    settingsVersionId: q.settingsVersionId,
    withholding: withholdingCodes(snapshotList(q.withholding)),
    withholdingPick: parseWithholdingPick(q.withholdingPick),
    contractPrice: money(q.contractPrice),
    withholdingTotal: money(q.withholdingTotal),
    netReceived: money(q.netReceived),
    supplierCost: money(q.supplierCost),
    netMargin: money(q.netMargin),
    netMarginPct: money(q.netMarginPct),
    items: auditItems(q.items.filter((i) => !i.removedAt)),
  };
}

/**
 * Money fields. When picks are non-empty, breakdown is one row per pick
 * (whole-total rates as their own lines) and withholdingTotal = sum of parts.
 */
function totalsData(items: PlannedItem[], picks: WithholdingSnapshot[] = []) {
  const t = docTotals(items, picks.length ? picks : undefined);
  return {
    contractPrice: t.contractPrice,
    withholdingTotal: t.withholdingTotal,
    netReceived: t.netReceived,
    supplierCost: t.supplierCost,
    netMargin: t.netMargin,
    netMarginPct: t.netMarginPct,
  };
}

/** Document JSON: pick snapshots when picks drive the math; else line-derived summary. */
function withholdingFromItems(items: PlannedItem[], picks: WithholdingSnapshot[] = []) {
  if (picks.length) return picks;
  return withholdingSnapshotFromLines(items);
}

/**
 * Resolve quote-level pick codes → rate snapshots (skip unknown/inactive on copy).
 * null pick → empty snapshots (0 WH); [] → empty; [codes] → active rates.
 */
async function resolvePickSnapshots(codes: string[] | null): Promise<WithholdingSnapshot[]> {
  if (!codes || codes.length === 0) return [];
  const current = await listWithholdingRates(db, { activeOnly: false });
  return buildWithholdingSnapshot(codes, current, [], { skipUnknown: true });
}

/** Decide the stored withholdingPick JSON from the input + existing quote/customer. */
function resolveWithholdingPickInput(
  input: QuoteInput,
  fallback: string[] | null,
): string[] | null {
  if (input.withholdingExplicitNone === true) return [];
  if (input.withholdingCodes === null) return null;
  if (input.withholdingCodes !== undefined) return [...new Set(input.withholdingCodes)];
  return fallback;
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

  // Copy the customer's saved pick unless the payload overrides it.
  const customerPick = parseWithholdingPick(customer.defaultWithholding);
  const pick = resolveWithholdingPickInput(input, customerPick);
  const pickSnapshots = await resolvePickSnapshots(pick);
  // Line rates drive totals; document withholding JSON is a read-only summary.
  const { items } = planItems([], input.items, withCosts, {
    withholdingPicks: pickSnapshots,
    // Always apply the pick on create so blank lines get the customer's rates.
    reapplyWithholding: input.reapplyWithholding === true || input.items.every((i) => i.withholdingRate === undefined),
  });
  // Picks drive breakdown unless any line is an explicit staff override.
  const hasLineOverride = items.some((i) => i.withholdingOverride);
  const usePicks = pickSnapshots.length > 0 && !hasLineOverride;
  const withholding = usePicks
    ? withholdingFromItems(items, pickSnapshots)
    : withholdingFromItems(items);
  const moneyTotals = usePicks ? totalsData(items, pickSnapshots) : totalsData(items);
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
          internalNotes: input.internalNotes ?? null,
          subject: input.subject ?? null,
          buyerPoNo: input.buyerPoNo ?? null,
          settingsVersionId: snap.versionId,
          withholding: withholding as unknown as Prisma.InputJsonValue,
          withholdingPick: pick === null ? Prisma.DbNull : (pick as unknown as Prisma.InputJsonValue),
          ...moneyTotals,
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
  await checkCustomerAndContact(input.customerId, input.contactId, { allowInactiveCustomerId: current.customerId });
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
      const existingPick = parseWithholdingPick(before.withholdingPick);
      const pick = resolveWithholdingPickInput(input, existingPick);
      const pickSnapshots = await resolvePickSnapshots(pick);
      const { items: planned, removedIds } = planItems(stored, input.items, withCosts, {
        withholdingPicks: pickSnapshots,
        reapplyWithholding: input.reapplyWithholding === true,
      });
      // Legacy NULL line rates must not recompute stored WH to ₱0 on save.
      const preserved = preserveLegacyWithholdingOnSave(before, planned);
      if (!preserved.ok) throw new DocRuleError(preserved.message);
      const items = preserved.items;
      // Picks drive the internal breakdown (whole-total rates as own lines) unless any
      // line is an explicit staff override — then line rates own the money math.
      const hasLineOverride = items.some((i) => i.withholdingOverride);
      const usePicks = pickSnapshots.length > 0 && !hasLineOverride;
      const withholding = usePicks ? withholdingFromItems(items, pickSnapshots) : preserved.withholding;
      const moneyTotals = usePicks ? totalsData(items, pickSnapshots) : preserved.totals;

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
          internalNotes: input.internalNotes ?? null,
          subject: input.subject ?? null,
          buyerPoNo: input.buyerPoNo ?? null,
          withholding: withholding as unknown as Prisma.InputJsonValue,
          withholdingPick: pick === null ? Prisma.DbNull : (pick as unknown as Prisma.InputJsonValue),
          ...moneyTotals,
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

/** Save explicit none ([]), then mark the draft as sent. Used by the submit confirm. */
export async function confirmNoneAndMarkQuoteSent(id: string, actor: DocActor): Promise<QuoteWithItems> {
  assertCan(actor, "edit_data");
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (before.status !== "DRAFT") throw new DocRuleError("Only a draft quote can be marked as sent.");
    const after = await tx.quote.update({
      where: { id },
      data: {
        withholdingPick: [] as unknown as Prisma.InputJsonValue,
        status: "SENT",
        updatedById: actor.id,
      },
      include: { items: { where: { removedAt: null } } },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Quote",
      entityId: id,
      action: "update",
      before: { status: before.status, withholdingPick: parseWithholdingPick(before.withholdingPick) },
      after: { status: after.status, withholdingPick: [] },
    });
    return after;
  }, DOC_TX);
}

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

/**
 * Point a draft quote at the latest SettingsVersion so its print letterhead
 * picks up current company details. Sent / WON / LOST / VOID stay frozen.
 */
export async function refreshQuoteCompanyDetails(id: string, actor: DocActor): Promise<QuoteWithItems> {
  assertCan(actor, "edit_data");
  const snap = await getSettingsSnapshot();
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (!quoteCanRefreshCompanyDetails(before.status)) {
      throw new DocRuleError("Only draft (unsent) quotes can refresh company details from settings.");
    }
    if (before.settingsVersionId === snap.versionId) {
      return before;
    }
    const after = await tx.quote.update({
      where: { id },
      data: { settingsVersionId: snap.versionId, updatedById: actor.id },
      include: { items: { where: { removedAt: null } } },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Quote",
      entityId: id,
      action: "update",
      before: { settingsVersionId: before.settingsVersionId },
      after: { settingsVersionId: after.settingsVersionId },
    });
    return after;
  });
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
