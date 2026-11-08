// Quotes: create, edit, mark sent / lost, void, convert to sales order, email
// draft. Every function checks permissions itself (server-side), runs in one
// transaction with its audit row, and never deletes anything.

import { Prisma, type Quote, type QuoteItem } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { addDays, manilaToday } from "../format";
import { assertCan, assertCanApprove, assertCanVoid, canSeeCosts, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { auditItems, DocRuleError, DOC_TX, money, withholdingCodes, withTxRetry, ymd } from "../documents/common";
import {
  quoteApprovalClearData,
  quoteMoneyFieldsChanged,
  quoteNotApprovedError,
} from "../quotes/approval";
import { docTotals, withholdingSnapshotFromLines, type WithholdingSnapshot } from "../quotes/calc";
import { itemData, planItems, type PlannedItem } from "../quotes/items";
import { preserveLegacyWithholdingOnSave } from "../quotes/legacy-withholding";
import { parseWithholdingPick } from "../quotes/withholding-defaults";
import { formatAddress } from "../addresses/format";
import { generateUniqueTrackingRef } from "../tracking-ref";
import {
  QUOTE_ZERO_TOTAL_ERROR,
  quoteTotalIsPositive,
  voidReasonSchema,
  type AcceptanceInput,
  type ConvertInput,
  type ItemInput,
  type QuoteInput,
} from "../validation/quotes";
import { buildWithholdingSnapshot, listWithholdingRates, snapshotList } from "./withholding";
import { notifyOrderConfirmed } from "../messaging/order-text-triggers";

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
    approvalStatus: q.approvalStatus,
    approvedById: q.approvedById,
    approvedAt: q.approvedAt ? q.approvedAt.toISOString() : null,
    rejectedById: q.rejectedById,
    rejectedAt: q.rejectedAt ? q.rejectedAt.toISOString() : null,
    rejectReason: q.rejectReason,
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

function assertQuoteApproved(quote: Pick<Quote, "approvalStatus">) {
  const err = quoteNotApprovedError(quote.approvalStatus);
  if (err) throw new DocRuleError(err);
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

/** Catalog links must point at real items (only the picker can set them). */
export async function checkItems(items: readonly Pick<ItemInput, "itemId">[]) {
  const ids = [...new Set(items.map((i) => i.itemId).filter((v): v is string => !!v))];
  if (!ids.length) return;
  const found = await db.item.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new DocRuleError("One of the linked products no longer exists. Pick again.", "items");
}

function hasNewCatalogFields(nc: NonNullable<ItemInput["newCatalog"]> | undefined): boolean {
  if (!nc) return false;
  return [nc.brand, nc.model, nc.category, nc.sku, nc.details].some((v) => v != null && v !== "");
}

/**
 * Catalog Step 3: lines typed with catalog fields (and no link yet) get a
 * catalog item created in the same transaction, and the line links to it.
 * Returns the item id per input index (null = no link). Runs inside the
 * quote transaction so a failed save never leaves an orphan catalog row.
 */
async function resolveNewCatalogItems(tx: Tx, inputs: readonly ItemInput[]): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const input of inputs) {
    if (input.itemId) {
      out.push(input.itemId);
      continue;
    }
    if (!hasNewCatalogFields(input.newCatalog)) {
      out.push(null);
      continue;
    }
    const nc = input.newCatalog!;
    const created = await tx.item.create({
      data: {
        name: input.description.trim(),
        brand: nc.brand ?? null,
        model: nc.model ?? null,
        category: nc.category ?? null,
        sku: nc.sku ?? null,
        unit: input.unit.trim(),
        kind: input.kind,
        details: nc.details ?? null,
      },
    });
    out.push(created.id);
  }
  return out;
}

/** Suppliers on items must exist (only cost users can set them). */
export async function checkSuppliers(items: readonly Pick<ItemInput, "supplierId">[]) {
  const ids = [...new Set(items.map((i) => i.supplierId).filter((v): v is string => !!v))];
  if (!ids.length) return;
  const found = await db.supplier.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new DocRuleError("One of the suppliers no longer exists. Pick again.", "items");
}

/** Preparer picker: the chosen preparer must be a real, active staff user. */
async function checkPreparedBy(id: string) {
  const found = await db.user.count({ where: { id, active: true } });
  if (found !== 1) throw new DocRuleError("Pick a staff member to prepare this quote.", "preparedById");
}

/**
 * Delivery address pick (2026-11-08): the address must be one of the
 * customer's saved, unarchived addresses — the same rule conversion uses.
 * Returns the id plus the text snapshot stored on the quote, so later edits
 * to the address record never change the saved quote.
 */
async function resolveDeliveryPick(customerId: string, addressId: string) {
  const address = await db.address.findFirst({
    where: { id: addressId, customerId, archivedAt: null },
  });
  if (!address) {
    throw new DocRuleError("That delivery address doesn't belong to this customer.", "deliveryAddressId");
  }
  return { deliveryAddressId: address.id, deliveryAddressText: formatAddress(address, { multiline: true }) };
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
  await checkItems(input.items);
  // Preparer picker: the chosen preparer, else the creator.
  const preparedById = input.preparedById ?? actor.id;
  await checkPreparedBy(preparedById);
  // Delivery pick: validate ownership and snapshot the text (null = no pick).
  const delivery = input.deliveryAddressId
    ? await resolveDeliveryPick(customer.id, input.deliveryAddressId)
    : { deliveryAddressId: null, deliveryAddressText: null };

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
  // S-78: no API path may save a ₱0 quote — the schema blocks it first, this
  // guards any caller that bypasses validation.
  if (!quoteTotalIsPositive(moneyTotals.contractPrice)) throw new DocRuleError(QUOTE_ZERO_TOTAL_ERROR);
  const validUntil =
    input.validUntil ??
    (input.validForDays != null
      ? addDays(input.date, input.validForDays)
      : addDays(input.date, snap.settings.quotes.defaultValidityDays));
  const year = input.date.getUTCFullYear();
  const format = snap.settings.numbering.quote;

  await ensureSeries(db, "QUOTE", year, format);
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const number = await allocateDocNumber(tx, "QUOTE", year, format);
      // New-catalog lines get their item created here; planned items share
      // input order, so the resolved ids line up by index.
      const catalogIds = await resolveNewCatalogItems(tx, input.items);
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
          deliveryNotes: input.deliveryNotes ?? null,
          warrantyNotes: input.warrantyNotes ?? null,
          leadTimeDays: input.leadTimeDays ?? null,
          subject: input.subject ?? null,
          buyerPoNo: input.buyerPoNo ?? null,
          deliveryAddressId: delivery.deliveryAddressId,
          deliveryAddressText: delivery.deliveryAddressText,
          settingsVersionId: snap.versionId,
          withholding: withholding as unknown as Prisma.InputJsonValue,
          withholdingPick: pick === null ? Prisma.DbNull : (pick as unknown as Prisma.InputJsonValue),
          ...moneyTotals,
          createdById: actor.id,
          preparedById,
          updatedById: actor.id,
          items: { create: items.map((p, idx) => ({ ...itemData(p), itemId: catalogIds[idx] ?? p.itemId })) },
        },
        include: { items: true },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "Quote", entityId: quote.id, action: "create", after: quoteAudit(quote) });
      return quote;
    }, DOC_TX),
  );
}

/**
 * S-55: Duplicate / New revision. Copies a quote into a fresh DRAFT with a
 * new number, verbatim lines (prices, costs, withholding), totals and notes.
 * Approval, sent state and the buyer PO number are NOT carried over — the
 * copy is a new document that needs its own approval and buyer PO ref.
 * `revision` is 1 for a duplicate, original + 1 for a new revision.
 */
export async function copyQuote(id: string, actor: DocActor, revision: number): Promise<QuoteWithItems> {
  assertCan(actor, "edit_data");
  const original = await db.quote.findUnique({
    where: { id },
    include: { items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
  });
  if (!original) throw new DocRuleError("Quote not found.");
  if (original.status === "VOID") throw new DocRuleError("A void quote cannot be copied.");
  const snap = await getSettingsSnapshot();
  const today = manilaToday();
  const year = today.getUTCFullYear();
  const format = snap.settings.numbering.quote;
  await ensureSeries(db, "QUOTE", year, format);
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const number = await allocateDocNumber(tx, "QUOTE", year, format);
      const copy = await tx.quote.create({
        data: {
          number,
          revision,
          customerId: original.customerId,
          contactId: original.contactId,
          date: today,
          validUntil: addDays(today, snap.settings.quotes.defaultValidityDays),
          terms: original.terms,
          notes: original.notes,
          internalNotes: original.internalNotes,
          leadTimeDays: original.leadTimeDays,
          subject: original.subject,
          // The copy keeps the delivery pick + its snapshot (same customer).
          deliveryAddressId: original.deliveryAddressId,
          deliveryAddressText: original.deliveryAddressText,
          buyerPoNo: null,
          settingsVersionId: snap.versionId,
          withholding: original.withholding as unknown as Prisma.InputJsonValue,
          withholdingPick: original.withholdingPick as unknown as Prisma.InputJsonValue,
          contractPrice: original.contractPrice,
          withholdingTotal: original.withholdingTotal,
          netReceived: original.netReceived,
          supplierCost: original.supplierCost,
          netMargin: original.netMargin,
          netMarginPct: original.netMarginPct,
          createdById: actor.id,
          preparedById: actor.id,
          updatedById: actor.id,
          items: {
            create: original.items.map((item) => ({
              sortOrder: item.sortOrder,
              description: item.description,
              kind: item.kind,
              qty: item.qty,
              unit: item.unit,
              supplierId: item.supplierId,
              itemId: item.itemId,
              supplierUnitCost: item.supplierUnitCost,
              unitPrice: item.unitPrice,
              total: item.total,
              supplierTotal: item.supplierTotal,
              margin: item.margin,
              withholdingRate: item.withholdingRate,
              withholdingAtc: item.withholdingAtc,
              withholdingOverride: item.withholdingOverride,
            })),
          },
        },
        include: { items: true },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "Quote", entityId: copy.id, action: "create", after: quoteAudit(copy) });
      return copy;
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
  await checkItems(input.items);
  // Preparer picker: omitted → keep the stored preparer; null → back to the
  // creator; a NEW value must be an active staff user. The stored preparer
  // may have been turned off since — saving without changing it stays valid.
  const preparedByData: { preparedById?: string | null } = {};
  if (input.preparedById !== undefined) {
    if (input.preparedById === null) preparedByData.preparedById = null;
    else if (input.preparedById !== current.preparedById) {
      await checkPreparedBy(input.preparedById);
      preparedByData.preparedById = input.preparedById;
    }
  }
  // Delivery pick: omitted → keep the stored pick; null → clear it; a NEW
  // id is validated against the (possibly changed) customer and
  // re-snapshotted. The same id keeps the stored snapshot text, so editing
  // the address record later never rewrites this quote.
  const deliveryData: { deliveryAddressId?: string | null; deliveryAddressText?: string | null } = {};
  if (input.deliveryAddressId !== undefined) {
    if (input.deliveryAddressId === null) {
      deliveryData.deliveryAddressId = null;
      deliveryData.deliveryAddressText = null;
    } else if (input.deliveryAddressId !== current.deliveryAddressId || input.customerId !== current.customerId) {
      Object.assign(deliveryData, await resolveDeliveryPick(input.customerId, input.deliveryAddressId));
    }
  }

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
      // New-catalog lines get their item created here, before planning.
      const catalogIds = await resolveNewCatalogItems(tx, input.items);
      const inputsWithCatalog = input.items.map((inp, idx) => ({ ...inp, itemId: catalogIds[idx] ?? inp.itemId ?? null }));
      const existingPick = parseWithholdingPick(before.withholdingPick);
      const pick = resolveWithholdingPickInput(input, existingPick);
      const pickSnapshots = await resolvePickSnapshots(pick);
      const { items: planned, removedIds } = planItems(stored, inputsWithCatalog, withCosts, {
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
      // S-78: re-saving an edit at ₱0 is blocked, same as a new ₱0 quote.
      if (!quoteTotalIsPositive(moneyTotals.contractPrice)) throw new DocRuleError(QUOTE_ZERO_TOTAL_ERROR);

      if (removedIds.length) {
        await tx.quoteItem.updateMany({ where: { id: { in: removedIds }, quoteId: id }, data: { removedAt: new Date() } });
      }
      for (const item of items) {
        if (item.id) await tx.quoteItem.update({ where: { id: item.id }, data: { ...itemData(item), itemId: item.itemId } });
        else await tx.quoteItem.create({ data: { ...itemData(item), itemId: item.itemId, quoteId: id } });
      }
      const withholdingKeyOf = (rows: readonly WithholdingSnapshot[]) =>
        [...rows]
          .map((w) => `${w.code}:${w.rate}`)
          .sort()
          .join("|");
      const beforeItems = before.items
        .filter((i) => !i.removedAt)
        .map((i) => ({
          id: i.id,
          qty: money(i.qty),
          unitPrice: money(i.unitPrice),
          total: money(i.total),
          supplierUnitCost: money(i.supplierUnitCost),
          supplierTotal: money(i.supplierTotal),
          withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
          withholdingAtc: i.withholdingAtc ?? null,
        }));
      const afterItems = items.map((i) => ({
        id: i.id,
        qty: i.qty,
        unitPrice: i.unitPrice,
        total: i.total,
        supplierUnitCost: i.supplierUnitCost,
        supplierTotal: i.supplierTotal,
        withholdingRate: i.withholdingRate,
        withholdingAtc: i.withholdingAtc,
      }));
      const moneyChanged = quoteMoneyFieldsChanged(
        {
          contractPrice: money(before.contractPrice),
          withholdingTotal: money(before.withholdingTotal),
          netReceived: money(before.netReceived),
          supplierCost: money(before.supplierCost),
          netMargin: money(before.netMargin),
          netMarginPct: money(before.netMarginPct),
          withholdingKey: withholdingKeyOf(snapshotList(before.withholding)),
          items: beforeItems,
        },
        {
          contractPrice: money(moneyTotals.contractPrice),
          withholdingTotal: money(moneyTotals.withholdingTotal),
          netReceived: money(moneyTotals.netReceived),
          supplierCost: money(moneyTotals.supplierCost),
          netMargin: money(moneyTotals.netMargin),
          netMarginPct: money(moneyTotals.netMarginPct),
          withholdingKey: withholdingKeyOf(Array.isArray(withholding) ? withholding : snapshotList(withholding)),
          items: afterItems,
        },
      );
      const resetApproval =
        moneyChanged && (before.approvalStatus === "APPROVED" || before.approvalStatus === "REJECTED");

      const after = await tx.quote.update({
        where: { id },
        data: {
          customerId: input.customerId,
          contactId: input.contactId,
          date: input.date,
          validUntil:
            input.validUntil ??
            (input.validForDays != null ? addDays(input.date, input.validForDays) : before.validUntil),
          terms: input.terms,
          notes: input.notes,
          internalNotes: input.internalNotes ?? null,
          deliveryNotes: input.deliveryNotes ?? null,
          warrantyNotes: input.warrantyNotes ?? null,
          leadTimeDays: input.leadTimeDays ?? null,
          subject: input.subject ?? null,
          buyerPoNo: input.buyerPoNo ?? null,
          withholding: withholding as unknown as Prisma.InputJsonValue,
          withholdingPick: pick === null ? Prisma.DbNull : (pick as unknown as Prisma.InputJsonValue),
          ...moneyTotals,
          ...(resetApproval ? quoteApprovalClearData() : {}),
          ...preparedByData,
          ...deliveryData,
          updatedById: actor.id,
        },
        include: { items: { where: { removedAt: null } } },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Quote",
        entityId: id,
        action: "update",
        before: {
          ...quoteAudit(before),
          ...(resetApproval ? { approval: before.approvalStatus === "REJECTED" ? "rejected" : "approved" } : {}),
        },
        after: {
          ...quoteAudit(after),
          ...(resetApproval ? { approval: "cleared (edited after approval)" } : {}),
        },
      });
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
    // S-78: a ₱0 quote (e.g. one saved before this block existed) can't be sent.
    if (!quoteTotalIsPositive(money(before.contractPrice))) throw new DocRuleError(QUOTE_ZERO_TOTAL_ERROR);
    if (before.status !== "DRAFT") throw new DocRuleError("Only a draft quote can be marked as sent.");
    assertQuoteApproved(before);
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

async function setStatus(id: string, actor: DocActor, from: readonly Quote["status"][], to: Quote["status"], message: string, requireApproved = false, requirePositiveTotal = false) {
  assertCan(actor, "edit_data");
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    // S-78: sending a ₱0 quote is blocked; other status moves (e.g. mark lost) are not.
    if (requirePositiveTotal && !quoteTotalIsPositive(money(before.contractPrice))) throw new DocRuleError(QUOTE_ZERO_TOTAL_ERROR);
    if (!from.includes(before.status)) throw new DocRuleError(message);
    if (requireApproved) assertQuoteApproved(before);
    const after = await tx.quote.update({ where: { id }, data: { status: to, updatedById: actor.id }, include: { items: { where: { removedAt: null } } } });
    await writeAudit(tx, { userId: actor.id, entityType: "Quote", entityId: id, action: "update", before: { status: before.status }, after: { status: after.status } });
    return after;
  });
}

export function markQuoteSent(id: string, actor: DocActor) {
  return setStatus(id, actor, ["DRAFT"], "SENT", "Only a draft quote can be marked as sent.", true, true);
}

/** Approver/Admin: PENDING → APPROVED. */
export async function approveQuote(id: string, actor: DocActor): Promise<QuoteWithItems> {
  assertCanApprove(actor);
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (before.status === "VOID") throw new DocRuleError("A void quote can't be approved.");
    if (before.approvalStatus === "APPROVED") throw new DocRuleError("This quote is already approved.");
    const now = new Date();
    const after = await tx.quote.update({
      where: { id },
      data: {
        approvalStatus: "APPROVED",
        approvedById: actor.id,
        approvedAt: now,
        rejectedById: null,
        rejectedAt: null,
        rejectReason: null,
        updatedById: actor.id,
      },
      include: { items: { where: { removedAt: null } } },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Quote",
      entityId: id,
      action: "update",
      before: { approvalStatus: before.approvalStatus },
      after: {
        approvalStatus: after.approvalStatus,
        approvedBy: "name" in actor && typeof actor.name === "string" ? actor.name : actor.id,
        approvedAt: now.toISOString(),
      },
    });
    return after;
  });
}

/** Approver/Admin: PENDING (or re-review) → REJECTED. Reason required. */
export async function rejectQuote(id: string, reason: string, actor: DocActor): Promise<QuoteWithItems> {
  assertCanApprove(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("Give a reason for rejecting this quote.", "reason");
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (before.status === "VOID") throw new DocRuleError("A void quote can't be rejected.");
    if (before.approvalStatus === "REJECTED") throw new DocRuleError("This quote is already rejected.");
    if (before.approvalStatus === "APPROVED") throw new DocRuleError("This quote is already approved. Edit prices to send it back for approval first.");
    const now = new Date();
    const after = await tx.quote.update({
      where: { id },
      data: {
        approvalStatus: "REJECTED",
        rejectedById: actor.id,
        rejectedAt: now,
        rejectReason: why,
        approvedById: null,
        approvedAt: null,
        updatedById: actor.id,
      },
      include: { items: { where: { removedAt: null } } },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Quote",
      entityId: id,
      action: "update",
      before: { approvalStatus: before.approvalStatus },
      after: {
        approvalStatus: after.approvalStatus,
        rejectedBy: "name" in actor && typeof actor.name === "string" ? actor.name : actor.id,
        rejectReason: why,
        rejectedAt: now.toISOString(),
      },
    });
    return after;
  });
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
  assertCanVoid(actor);
  const parsedReason = voidReasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    throw new DocRuleError(parsedReason.error.issues[0]?.message ?? "A reason is required.", "reason");
  }
  const why = parsedReason.data;
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (before.status === "VOID") throw new DocRuleError("This quote is already void.");
    const activeSo = await tx.salesOrder.findFirst({ where: { quoteId: id, status: "OPEN" } });
    if (activeSo) throw new DocRuleError("Void the sales order first.");
    const now = new Date();
    const after = await tx.quote.update({
      where: { id },
      data: { status: "VOID", voidedAt: now, voidReason: why, updatedById: actor.id },
      include: { items: { where: { removedAt: null } } },
    });
    await tx.documentVoid.create({
      data: {
        docType: "QUOTE",
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
/** Audit (2026-11-05): record customer acceptance on a quote. The
 * acceptance (date, name, how) is the evidence conversion to SO checks
 * when there is no signed conforme file and no buyer PO number. */
export async function recordQuoteAcceptance(id: string, input: AcceptanceInput, actor: DocActor): Promise<QuoteWithItems> {
  assertCan(actor, "edit_data");
  return db.$transaction(async (tx) => {
    const before = await lockQuote(tx, id);
    if (before.status === "VOID") throw new DocRuleError("A void quote can't record acceptance.");
    if (before.status === "WON" || before.status === "LOST") throw new DocRuleError("This quote is already closed.");
    const after = await tx.quote.update({
      where: { id },
      data: {
        acceptedAt: input.acceptedAt,
        acceptedBy: input.acceptedBy,
        acceptedVia: input.acceptedVia,
        updatedById: actor.id,
      },
      include: { items: { where: { removedAt: null } } },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "Quote",
      entityId: id,
      action: "update",
      before: { acceptedAt: before.acceptedAt?.toISOString() ?? null },
      after: {
        acceptedAt: input.acceptedAt.toISOString(),
        acceptedBy: input.acceptedBy,
        acceptedVia: input.acceptedVia,
      },
    });
    return after;
  });
}

export async function convertQuoteToSalesOrder(id: string, input: ConvertInput, actor: DocActor, opts: { date?: Date } = {}) {
  assertCan(actor, "edit_data");
  const snap = await getSettingsSnapshot();
  const date = opts.date ?? manilaToday();
  const year = date.getUTCFullYear();
  const format = snap.settings.numbering.salesOrder;
  await ensureSeries(db, "SALES_ORDER", year, format);

  // Q16 S-95: order text AFTER the SO transaction commits, never inside it,
  // so a text failure can never roll back the order.
  const so = await withTxRetry(() =>
    db.$transaction(async (tx) => {
      const quote = await lockQuote(tx, id);
      if (quote.status === "VOID") throw new DocRuleError("A void quote can't be converted.");
      if (quote.status !== "DRAFT" && quote.status !== "SENT") {
        throw new DocRuleError("Only a draft or sent quote can be converted to a sales order.");
      }
      assertQuoteApproved(quote);
      await tx.customer.findUniqueOrThrow({ where: { id: quote.customerId } });
      if (!input.deliveryAddressId) {
        throw new DocRuleError("Pick a delivery address from the customer's saved addresses.", "deliveryAddressId");
      }
      const address = await tx.address.findFirst({
        where: { id: input.deliveryAddressId, customerId: quote.customerId, archivedAt: null },
      });
      if (!address) {
        throw new DocRuleError("That delivery address doesn't belong to this customer.", "deliveryAddressId");
      }
      const deliveryAddress = formatAddress(address, { multiline: true });
      // Audit (2026-11-05): conversion needs customer-acceptance evidence —
      // a signed conforme file, a buyer PO number, or a recorded acceptance.
      // Without this the conforme upload is process theatre: nothing ever
      // checked it. Checked after the address so address errors still read
      // as address errors.
      const hasBuyerPo = Boolean(input.buyerPoNo?.trim());
      const hasRecordedAcceptance = quote.acceptedAt !== null;
      const conformeCount = await tx.documentAttachment.count({
        where: { quoteId: quote.id, archivedAt: null },
      });
      if (!hasBuyerPo && !hasRecordedAcceptance && conformeCount === 0) {
        throw new DocRuleError(
          "Record customer acceptance first — upload a signed conforme, enter the buyer PO number, or record how the customer accepted.",
          "buyerPoNo",
        );
      }
      const number = await allocateDocNumber(tx, "SALES_ORDER", year, format);
      const trackingRef = await generateUniqueTrackingRef(async (ref) => !!(await tx.salesOrder.findUnique({ where: { trackingRef: ref }, select: { id: true } })));
      const so = await tx.salesOrder.create({
        data: {
          number,
          trackingRef,
          quoteId: quote.id,
          customerId: quote.customerId,
          contactId: quote.contactId,
          date,
          buyerPoNo: input.buyerPoNo,
          buyerPoDate: input.buyerPoDate ?? null,
          // Snapshot of the text: later address edits don't change the SO.
          deliveryAddress,
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
  await notifyOrderConfirmed(so.id, actor.id);
  return so;
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
  assertQuoteApproved(quote);
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
