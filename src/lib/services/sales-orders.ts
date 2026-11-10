// Sales orders: created only by converting a quote (see quotes.ts). Open SOs can
// be edited by Staff+ (audited); voiding returns the quote to Sent.

import type { Prisma, SalesOrder, SalesOrderItem, SalesOrderItemComponent } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, assertCanVoid, canSeeCosts } from "../permissions";
import { fromScaled, toScaled } from "../quotes/calc";
import { salesOrderMoney } from "../billing/status";
import { soDeliveryProgress } from "../sales-orders/delivery";
import { auditItems, DocRuleError, DOC_TX, money, withholdingCodes, withTxRetry, ymd } from "../documents/common";
import { itemData, planItems } from "../quotes/items";
import { preserveLegacyWithholdingOnSave, rateFromDocWithholding } from "../quotes/legacy-withholding";
import { parseWithholdingPick } from "../quotes/withholding-defaults";
import { voidReasonSchema, type GovDealInput, type SalesOrderInput } from "../validation/quotes";
import { checkSuppliers, type DocActor } from "./quotes";
import { buildWithholdingSnapshot, listWithholdingRates, snapshotList } from "./withholding";

type SoWithItems = SalesOrder & { items: (SalesOrderItem & { components?: SalesOrderItemComponent[] })[] };

export type SoPriceLine = {
  id: string | null;
  qty: string;
  unitPrice: string;
  kind: string;
  withholdingRate: string | null;
  withholdingAtc: string | null;
};

export type SoPriceSnapshot = {
  contractPrice: string;
  withholdingTotal: string;
  netReceived: string;
  lines: readonly SoPriceLine[];
};

function scaledEq(a: string, b: string, dp = 2): boolean {
  return toScaled(a || "0", dp) === toScaled(b || "0", dp);
}

function rateEq(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left && !right) return true;
  if (!left || !right) return false;
  return scaledEq(left, right, 4);
}

/** Qty, unit price, kind, withholding rate/ATC, line add/remove, or the selling / withholding / net totals. */
export function salesOrderPricesChanged(before: SoPriceSnapshot, after: SoPriceSnapshot): boolean {
  if (!scaledEq(before.contractPrice, after.contractPrice)) return true;
  if (!scaledEq(before.withholdingTotal, after.withholdingTotal)) return true;
  if (!scaledEq(before.netReceived, after.netReceived)) return true;
  const beforeById = new Map(before.lines.filter((l) => l.id).map((l) => [l.id as string, l]));
  const afterById = new Map(after.lines.filter((l) => l.id).map((l) => [l.id as string, l]));
  if (beforeById.size !== afterById.size) return true;
  if (after.lines.some((l) => !l.id)) return true;
  if (before.lines.length !== after.lines.length) return true;
  for (const [id, line] of beforeById) {
    const next = afterById.get(id);
    if (!next) return true;
    if (!scaledEq(line.qty, next.qty)) return true;
    if (!scaledEq(line.unitPrice, next.unitPrice)) return true;
    if (line.kind !== next.kind) return true;
    if (!rateEq(line.withholdingRate, next.withholdingRate)) return true;
    if ((line.withholdingAtc ?? "").trim() !== (next.withholdingAtc ?? "").trim()) return true;
  }
  return false;
}

export const PRICE_LOCK_MESSAGE = "Won sales order prices are locked. An Admin can change them with a reason.";
export const PRICE_OVERRIDE_REASON = "Give a reason (at least 3 characters).";

/** Null when the save may proceed. Staff cannot change prices. Admin must give a reason. */
export function salesOrderPriceLockError(opts: {
  isAdmin: boolean;
  reason: string | null | undefined;
  before: SoPriceSnapshot;
  after: SoPriceSnapshot;
}): string | null {
  if (!salesOrderPricesChanged(opts.before, opts.after)) return null;
  if (!opts.isAdmin) return PRICE_LOCK_MESSAGE;
  if ((opts.reason ?? "").trim().length < 3) return PRICE_OVERRIDE_REASON;
  return null;
}

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
    philgepsRef: so.philgepsRef,
    bidNo: so.bidNo,
    noaDate: ymd(so.noaDate),
    agencyPoNo: so.agencyPoNo,
    iarDate: ymd(so.iarDate),
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
  const so = await tx.salesOrder.findUnique({
    where: { id },
    include: {
      items: {
        where: { removedAt: null },
        include: { components: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!so) throw new DocRuleError("Sales order not found.");
  return so;
}

/** Audit A (2026-11-05): recompute an SO's open/closed state in the same
 * transaction as the billing, collection or delivery change that may have
 * completed it. Closes when fully billed AND fully paid AND fully
 * delivered; reopens when a later change breaks that. VOID is never
 * touched, and nothing happens when the state is already right. Callers
 * are the billing, collection (via recomputeBillingStatus) and delivery
 * services, plus updateSalesOrder for item/total edits. */
export async function refreshSalesOrderCloseState(tx: Tx, salesOrderId: string, actorId: string): Promise<void> {
  const so = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { status: true, contractPrice: true },
  });
  if (!so || so.status === "VOID") return;
  const billings = await tx.billing.findMany({
    where: { salesOrderId, status: { not: "VOID" } },
    include: { allocations: { where: { collection: { status: "POSTED" } } } },
  });
  const moneySnap = salesOrderMoney(
    so.status,
    money(so.contractPrice),
    billings.map((b) => ({
      status: b.status,
      amount: money(b.amount),
      cashApplied: fromScaled(b.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n), 2),
      withholdingApplied: fromScaled(b.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n), 2),
    })),
  );
  const items = await tx.salesOrderItem.findMany({
    where: { salesOrderId, removedAt: null },
    select: { qty: true, deliveredQty: true },
  });
  const delivered = soDeliveryProgress(
    items.map((i) => ({ qty: money(i.qty), deliveredQty: money(i.deliveredQty) })),
  );
  const target = moneySnap.completed && delivered.fullyDelivered ? "CLOSED" : "OPEN";
  if (target === so.status) return;
  await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status: target, updatedById: actorId } });
  await writeAudit(tx, {
    userId: actorId,
    entityType: "SalesOrder",
    entityId: salesOrderId,
    action: "update",
    before: { status: so.status },
    after: {
      status: target,
      reason: target === "CLOSED" ? "Fully billed, paid and delivered" : "No longer fully billed, paid and delivered",
    },
    diff: false,
  });
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
        // Lot lines: planItems (preserveLots) keeps these components and
        // their costs; the SO editor's payload never carries them.
        isLot: i.isLot,
        components: (i.components ?? []).map((c) => ({
          itemId: c.itemId,
          description: c.description,
          qty: money(c.qty),
          unit: c.unit,
          supplierId: c.supplierId,
          unitCost: money(c.unitCost),
        })),
        withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
        withholdingAtc: i.withholdingAtc,
        withholdingOverride: i.withholdingOverride,
      }));
      // Re-apply uses the customer's current saved pick (explicit staff action).
      // Changing the customer pick alone never rewrites this SO.
      const pickCodes =
        input.withholdingCodes !== undefined
          ? input.withholdingCodes
          : parseWithholdingPick(customer.defaultWithholding);
      const rates = await listWithholdingRates(tx, { activeOnly: false });
      const pickSnapshots =
        pickCodes && pickCodes.length
          ? buildWithholdingSnapshot(pickCodes, rates, [], { skipUnknown: true })
          : [];
      const { items: planned, removedIds } = planItems(stored, input.items, withCosts, {
        withholdingPicks: pickSnapshots,
        reapplyWithholding: input.reapplyWithholding === true,
        preserveLots: true,
      });
      // Legacy NULL line rates must not recompute stored WH to ₱0 on save.
      const preserved = preserveLegacyWithholdingOnSave(before, planned);
      if (!preserved.ok) throw new DocRuleError(preserved.message);
      const items = preserved.items;
      const priceOverrideReason = (input.priceOverrideReason ?? "").trim();
      const beforePrices = {
        contractPrice: money(before.contractPrice),
        withholdingTotal: money(before.withholdingTotal),
        netReceived: money(before.netReceived),
        // NULL line rates are filled from this order's own withholding JSON on save.
        // That fill is the snapshot already stored on the document, so it is not a
        // price or ATC change. A submitted rate or ATC still has to match it.
        lines: before.items.map((i) => {
          const storedRate = i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null;
          const fromDoc = storedRate == null ? rateFromDocWithholding(before.withholding, i.kind) : null;
          return {
            id: i.id,
            qty: money(i.qty),
            unitPrice: money(i.unitPrice),
            kind: i.kind,
            withholdingRate: storedRate ?? fromDoc?.withholdingRate ?? null,
            withholdingAtc: i.withholdingAtc ?? fromDoc?.withholdingAtc ?? null,
          };
        }),
      };
      const afterPrices = {
        contractPrice: money(preserved.totals.contractPrice),
        withholdingTotal: money(preserved.totals.withholdingTotal),
        netReceived: money(preserved.totals.netReceived),
        // Compare the planned / persisted rows that will actually be saved.
        lines: items.map((i) => ({
          id: i.id ?? null,
          qty: money(i.qty),
          unitPrice: money(i.unitPrice),
          kind: i.kind,
          withholdingRate: i.withholdingRate ?? null,
          withholdingAtc: i.withholdingAtc ?? null,
        })),
      };
      // Delivered qty is authoritative: cannot remove a delivered line or drop
      // ordered qty below what was already delivered (check before price lock).
      const beforeById = new Map(before.items.map((i) => [i.id, i]));
      for (const rid of removedIds) {
        const prev = beforeById.get(rid);
        if (prev && toScaled(money(prev.deliveredQty), 2) > 0n) {
          throw new DocRuleError(
            "Void deliveries on this line before removing it.",
            `items.${rid}`,
          );
        }
      }
      for (const item of items) {
        if (!item.id) continue;
        const prev = beforeById.get(item.id);
        if (!prev) continue;
        const delivered = toScaled(money(prev.deliveredQty), 2);
        if (delivered > 0n && toScaled(money(item.qty), 2) < delivered) {
          throw new DocRuleError(
            `Ordered quantity cannot be below delivered (${money(prev.deliveredQty).replace(/\.00$/, "")}).`,
            `items.${item.id}.qty`,
          );
        }
      }
      // SO guards (REQ-PLAN-AUDIT-001 A1–A3; owner-approved 2026-11-10).
      // Everything below is computed inside the SO row lock taken above, so
      // a concurrent PO create/picker save cannot slip past the floors.
      const liveBillings = await tx.billing.findMany({
        where: { salesOrderId: id, status: { not: "VOID" } },
        select: { invoiceNo: true, amount: true },
        orderBy: { createdAt: "asc" },
      });
      if (liveBillings.length) {
        // A1 (REVISED — looser rule; Jerwin direct 2026-11-10 17:17, final
        // approval 17:22): once an SI exists, the BIR core is frozen for
        // everyone — no line removals and no withholding rate/ATC/pick
        // changes, because the 2307 split reads the live SO. Everything
        // else stays editable: qty/price changes and line adds go through
        // the price lock below (Admin + typed reason, audited) and the
        // A2/A3 floors. Each billing also carries its own withholding
        // breakdown from record time, so allowed edits cannot move an
        // issued SI's split.
        const siNo = liveBillings[0]!.invoiceNo;
        const whFrozen = `This order already has SI no. ${siNo}. Withholding can't change after a billing is issued — void that billing first.`;
        if (removedIds.length) {
          throw new DocRuleError(
            `This order already has SI no. ${siNo}. Lines can't be removed after a billing is issued — void that billing first.`,
            "items",
          );
        }
        const beforeLineById = new Map(beforePrices.lines.map((l) => [l.id, l]));
        for (const line of afterPrices.lines) {
          if (!line.id) continue;
          const prevLine = beforeLineById.get(line.id);
          if (!prevLine) continue;
          // beforePrices fills a stored NULL rate from the doc snapshot
          // (that fill is not a change); normalize the planned line the
          // same way — a line added with no rate keeps the snapshot rate,
          // so a plain re-save must not trip this freeze. A submitted
          // (non-null) rate or ATC still has to match exactly.
          const plannedRate = line.withholdingRate ?? null;
          const plannedFromDoc = plannedRate == null ? rateFromDocWithholding(before.withholding, line.kind) : null;
          const effRate = plannedRate ?? plannedFromDoc?.withholdingRate ?? null;
          const effAtc = (line.withholdingAtc ?? null) ?? (plannedRate == null ? (plannedFromDoc?.withholdingAtc ?? null) : null);
          if (!rateEq(prevLine.withholdingRate, effRate) || (prevLine.withholdingAtc ?? null) !== effAtc) {
            throw new DocRuleError(whFrozen, "items");
          }
        }
      }
      if (liveBillings.length) {
        // A2 hard floor: the contract price can never drop below what is
        // already billed (holds even if A1 is ever relaxed).
        const billedTotal = liveBillings.reduce((a, b) => a + toScaled(money(b.amount), 2), 0n);
        // The floor applies ONLY on money-moving saves (CTO ruling via
        // Errands, 2026-11-11): a save that moves no price, qty, kind,
        // withholding or line set never trips it — notes, terms, address,
        // contact and cost-only saves on a billed order go through, even
        // one already below billed from before this guard existed.
        if (
          salesOrderPricesChanged(beforePrices, afterPrices) &&
          toScaled(afterPrices.contractPrice, 2) < billedTotal
        ) {
          throw new DocRuleError(
            "The order total can't go below what is already billed.",
            "items",
          );
        }
      }
      // A3 ordered floor: live ordered qty per SO line / lot component =
      // PO lines not removed, on POs not VOID (a CLOSED PO counts its full
      // qty). Same live rule as the purchasing views.
      const componentIds = before.items.flatMap((i) => (i.components ?? []).map((c) => c.id));
      const livePoLines = await tx.purchaseOrderItem.findMany({
        where: {
          removedAt: null,
          purchaseOrder: { salesOrderId: id, status: { not: "VOID" } },
          OR: [
            { salesOrderItemId: { in: [...beforeById.keys()] } },
            ...(componentIds.length ? [{ salesOrderItemComponentId: { in: componentIds } }] : []),
          ],
        },
        select: { salesOrderItemId: true, salesOrderItemComponentId: true, qty: true },
      });
      const orderedByLine = new Map<string, bigint>();
      const orderedByComponent = new Map<string, bigint>();
      for (const l of livePoLines) {
        if (l.salesOrderItemId) orderedByLine.set(l.salesOrderItemId, (orderedByLine.get(l.salesOrderItemId) ?? 0n) + toScaled(money(l.qty), 2));
        if (l.salesOrderItemComponentId) orderedByComponent.set(l.salesOrderItemComponentId, (orderedByComponent.get(l.salesOrderItemComponentId) ?? 0n) + toScaled(money(l.qty), 2));
      }
      const lineOrdered = (lineId: string): bigint => {
        const prev = beforeById.get(lineId);
        let total = orderedByLine.get(lineId) ?? 0n;
        for (const c of prev?.components ?? []) total += orderedByComponent.get(c.id) ?? 0n;
        return total;
      };
      for (const rid of removedIds) {
        if (lineOrdered(rid) > 0n) {
          throw new DocRuleError(
            "This line is already on a purchase order. Void that PO before removing the line.",
            `items.${rid}`,
          );
        }
      }
      for (const item of items) {
        if (!item.id) continue;
        const prev = beforeById.get(item.id);
        if (!prev || prev.isLot) continue;
        const ordered = orderedByLine.get(item.id) ?? 0n;
        if (ordered > 0n && toScaled(money(item.qty), 2) < ordered) {
          throw new DocRuleError(
            `Ordered quantity cannot be below what is already on a purchase order (${fromScaled(ordered, 2)}).`,
            `items.${item.id}.qty`,
          );
        }
      }
      const lockMsg = salesOrderPriceLockError({
        isAdmin: actor.isAdmin === true,
        reason: priceOverrideReason,
        before: beforePrices,
        after: afterPrices,
      });
      if (lockMsg) throw new DocRuleError(lockMsg, lockMsg === PRICE_OVERRIDE_REASON ? "priceOverrideReason" : "items");
      const pricesChanged = salesOrderPricesChanged(beforePrices, afterPrices);
      if (removedIds.length) {
        await tx.salesOrderItem.updateMany({ where: { id: { in: removedIds }, salesOrderId: id }, data: { removedAt: new Date() } });
        // A removed lot line takes its components with it (soft-remove).
        await tx.salesOrderItemComponent.updateMany({
          where: { salesOrderItemId: { in: removedIds }, removedAt: null },
          data: { removedAt: new Date() },
        });
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
          // Government deal fields are owned by updateSalesOrderGovDeal /
          // GovernmentDealBox. DocumentEditor does not send them — writing
          // `noaDate`/`iarDate` as null here would wipe IAR (and Expected by).
          ...(input.philgepsRef !== undefined ? { philgepsRef: input.philgepsRef } : {}),
          ...(input.bidNo !== undefined ? { bidNo: input.bidNo } : {}),
          ...(input.noaDate !== undefined ? { noaDate: input.noaDate ?? null } : {}),
          ...(input.agencyPoNo !== undefined ? { agencyPoNo: input.agencyPoNo } : {}),
          ...(input.iarDate !== undefined ? { iarDate: input.iarDate ?? null } : {}),
          withholding: preserved.withholding as unknown as Prisma.InputJsonValue,
          ...preserved.totals,
          updatedById: actor.id,
        },
        include: { items: { where: { removedAt: null } } },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "update",
        before: salesOrderAudit(before),
        after: { ...salesOrderAudit(after), ...(pricesChanged ? { priceOverrideReason } : {}) },
      });
      // Audit A: an item/total edit can complete (or un-complete) the order.
      await refreshSalesOrderCloseState(tx, id, actor.id);
      return after;
    }, DOC_TX),
  );
}

/** Update government deal fields on a sales order (staff+). */
export async function updateSalesOrderGovDeal(id: string, input: GovDealInput, actor: DocActor) {
  assertCan(actor, "edit_data");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const before = await lockSalesOrder(tx, id);
      if (before.status === "VOID") throw new DocRuleError("This sales order is void.");

      const after = await tx.salesOrder.update({
        where: { id },
        data: {
          philgepsRef: input.philgepsRef,
          bidNo: input.bidNo,
          noaDate: input.noaDate ?? null,
          agencyPoNo: input.agencyPoNo,
          iarDate: input.iarDate ?? null,
          updatedById: actor.id,
        },
      });

      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "update",
        before: {
          philgepsRef: before.philgepsRef,
          bidNo: before.bidNo,
          noaDate: ymd(before.noaDate),
          agencyPoNo: before.agencyPoNo,
          iarDate: ymd(before.iarDate),
        },
        after: {
          philgepsRef: after.philgepsRef,
          bidNo: after.bidNo,
          noaDate: ymd(after.noaDate),
          agencyPoNo: after.agencyPoNo,
          iarDate: ymd(after.iarDate),
        },
      });

      return after;
    }, DOC_TX),
  );
}

/** Void an open SO (reason required). Its quote goes back to Sent so it can be converted again. */
export async function voidSalesOrder(id: string, reason: string, actor: DocActor) {
  assertCanVoid(actor);
  const parsedReason = voidReasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    throw new DocRuleError(parsedReason.error.issues[0]?.message ?? "A reason is required.", "reason");
  }
  const why = parsedReason.data;
  return db.$transaction(async (tx) => {
    const before = await lockSalesOrder(tx, id);
    if (before.status === "VOID") throw new DocRuleError("This sales order is already void.");
    await tx.$queryRaw`SELECT \`id\` FROM \`Quote\` WHERE \`id\` = ${before.quoteId} FOR UPDATE`;
    const now = new Date();
    const after = await tx.salesOrder.update({ where: { id }, data: { status: "VOID", voidedAt: now, voidReason: why, updatedById: actor.id } });
    await tx.documentVoid.create({
      data: {
        docType: "SALES_ORDER",
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
