// Supplier purchase orders: create from a sales order (one PO per supplier) or
// standalone, edit (Draft/Approved only), approve, mark sent, close, void,
// email draft. Every function checks permissions itself: PO data is cost data,
// so all of these need "Can see costs" on top of the role permission. Each
// change runs in one transaction with its audit row; nothing is deleted.

import type { Prisma, PurchaseOrder, PurchaseOrderItem } from "@prisma/client";
import { db, isUniqueViolation, type Tx } from "../db";
import { writeAudit } from "../audit";
import { manilaToday } from "../format";
import { assertCan, canSeeCosts, ForbiddenError, type Permission, type PermissionUser } from "../permissions";
import { getSettingsSnapshot, getSettingsVersion } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { fromScaled, lineAmounts, toScaled } from "../quotes/calc";
import { formatAddress } from "../addresses/format";
import {
  afterEdit,
  approverError,
  closeError,
  poActionError,
  poMarkSentError,
  poNeedsApproval,
  voidError,
  type PoStatus,
} from "../purchasing/status";
import { planPurchaseOrders, type PlannedPoLine } from "../purchasing/plan";
import type { CreateFromSoInput, PoInput, PoLineInput } from "../validation/purchasing";
import { defaultAddress } from "./addresses";

export type PoActor = PermissionUser & { id: string };

type PoWithItems = PurchaseOrder & { items: PurchaseOrderItem[] };

/** Role permission + "Can see costs" (POs hold unit costs). */
export function assertPoAccess(actor: PoActor, permission: Permission = "edit_data"): void {
  assertCan(actor, permission);
  if (!canSeeCosts(actor)) throw new ForbiddenError();
}

export function poAudit(po: PoWithItems) {
  return {
    number: po.number,
    revision: po.revision,
    status: po.status,
    supplierId: po.supplierId,
    supplierContactId: po.supplierContactId,
    salesOrderId: po.salesOrderId,
    date: ymd(po.date),
    expectedDate: ymd(po.expectedDate),
    terms: po.terms,
    deliveryAddressText: po.deliveryAddressText,
    supplierAddressText: po.supplierAddressText,
    notes: po.notes,
    subtotal: money(po.subtotal),
    items: [...po.items]
      .filter((i) => !i.removedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ description: i.description, kind: i.kind, qty: money(i.qty), unit: i.unit, unitCost: money(i.unitCost), total: money(i.total) })),
  };
}

export async function lockPurchaseOrder(tx: Tx, id: string): Promise<PoWithItems> {
  await tx.$queryRaw`SELECT \`id\` FROM \`PurchaseOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
  const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } } });
  if (!po) throw new DocRuleError("Purchase order not found.");
  return po;
}

const lineTotal = (qty: string, unitCost: string) => lineAmounts({ kind: "GOODS", qty, unitPrice: unitCost, supplierUnitCost: "0" }).total;

function subtotalOf(lines: readonly { qty: string; unitCost: string }[]): string {
  return fromScaled(
    lines.reduce((acc, l) => acc + toScaled(lineTotal(l.qty, l.unitCost), 2), 0n),
    2,
  );
}

/** The supplier's default office address, else default billing, formatted for the PO. */
export async function supplierAddressText(supplierId: string, client: Tx | typeof db = db): Promise<string | null> {
  const owner = { kind: "supplier", id: supplierId } as const;
  const a = (await defaultAddress(owner, "OFFICE", client)) ?? (await defaultAddress(owner, "BILLING", client));
  if (a) return formatAddress(a, { multiline: true });
  const s = await client.supplier.findUnique({ where: { id: supplierId }, select: { address: true } });
  return s?.address?.trim() || null;
}

async function checkSupplier(supplierId: string, contactId: string | null, opts: { allowInactiveId?: string } = {}) {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, include: { contacts: true } });
  if (!supplier || (!supplier.active && supplier.id !== opts.allowInactiveId)) throw new DocRuleError("Pick an active supplier.", "supplierId");
  if (contactId) {
    const c = supplier.contacts.find((x) => x.id === contactId);
    if (!c || !c.active) throw new DocRuleError("Pick an active contact of this supplier.", "supplierContactId");
  }
  return supplier;
}

const itemCreate = (l: PlannedPoLine | (PoLineInput & { salesOrderItemId?: string | null }), sortOrder: number) => ({
  sortOrder,
  description: l.description,
  kind: l.kind,
  qty: l.qty,
  unit: l.unit,
  unitCost: l.unitCost,
  total: lineTotal(l.qty, l.unitCost),
  salesOrderItemId: l.salesOrderItemId ?? null,
  activeSalesOrderItemId: l.salesOrderItemId ?? null,
});

// ---------------------------------------------------------------------------
// Create from a sales order
// ---------------------------------------------------------------------------

/** SO line ids already on a live (non-void, not removed) PO line. */
export async function orderedSoLineIds(soLineIds: readonly string[], client: Tx | typeof db = db): Promise<Set<string>> {
  if (!soLineIds.length) return new Set();
  const rows = await client.purchaseOrderItem.findMany({ where: { activeSalesOrderItemId: { in: [...soLineIds] } }, select: { activeSalesOrderItemId: true } });
  return new Set(rows.map((r) => r.activeSalesOrderItemId!));
}

/**
 * One Draft PO per supplier from an open sales order, in one transaction.
 * Lines without a supplier are skipped unless one is picked in the preview;
 * lines already on a live PO are skipped.
 */
export async function createPurchaseOrdersFromSalesOrder(salesOrderId: string, input: CreateFromSoInput, actor: PoActor) {
  assertPoAccess(actor);
  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.supplierPo;
  const year = input.date.getUTCFullYear();
  const picked = [...new Set(Object.values(input.supplierPicks).filter((v): v is string => !!v))];
  if (picked.length) {
    const n = await db.supplier.count({ where: { id: { in: picked }, active: true } });
    if (n !== picked.length) throw new DocRuleError("One of the picked suppliers is inactive or no longer exists.", "supplierPicks");
  }
  await ensureSeries(db, "PURCHASE_ORDER", year, format);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        // Lock the SO so two people creating POs from it queue up.
        await tx.$queryRaw`SELECT \`id\` FROM \`SalesOrder\` WHERE \`id\` = ${salesOrderId} FOR UPDATE`;
        const so = await tx.salesOrder.findUnique({
          where: { id: salesOrderId },
          include: { quote: { select: { status: true } }, items: { where: { removedAt: null } } },
        });
        if (!so) throw new DocRuleError("Sales order not found.");
        if (so.status !== "OPEN") throw new DocRuleError("POs can only be created from an open sales order.");
        if (so.quote.status !== "WON") throw new DocRuleError("The sales order's quote isn't Won.");
        const ordered = await orderedSoLineIds(
          so.items.map((i) => i.id),
          tx,
        );
        const plan = planPurchaseOrders(
          so.items.map((i) => ({ ...i, qty: money(i.qty), supplierUnitCost: money(i.supplierUnitCost) })),
          ordered,
          input.supplierPicks,
          input.lineIds ? new Set(input.lineIds) : undefined,
        );
        if (!plan.pos.length) {
          throw new DocRuleError(
            plan.needsSupplier.length ? "Pick a supplier for at least one line." : "Every line of this sales order is already on a PO.",
          );
        }
        const supplierIds = plan.pos.map((p) => p.supplierId);
        const suppliers = await tx.supplier.findMany({ where: { id: { in: supplierIds } }, include: { contacts: { where: { active: true } } } });
        const created: PoWithItems[] = [];
        for (const p of plan.pos) {
          const supplier = suppliers.find((s) => s.id === p.supplierId);
          if (!supplier) throw new DocRuleError("One of the suppliers no longer exists.");
          const number = await allocateDocNumber(tx, "PURCHASE_ORDER", year, format);
          const po = await tx.purchaseOrder.create({
            data: {
              number,
              supplierId: supplier.id,
              supplierContactId: supplier.contacts.find((c) => c.isMain)?.id ?? null,
              salesOrderId: so.id,
              date: input.date,
              expectedDate: input.expectedDate,
              terms: supplier.defaultTerms,
              deliveryAddressText: input.deliveryAddressText ?? so.deliveryAddress,
              supplierAddressText: await supplierAddressText(supplier.id, tx),
              settingsVersionId: snap.versionId,
              subtotal: subtotalOf(p.lines),
              createdById: actor.id,
              updatedById: actor.id,
              items: { create: p.lines.map((l, i) => itemCreate(l, i)) },
            },
            include: { items: true },
          });
          await writeAudit(tx, {
            userId: actor.id,
            entityType: "PurchaseOrder",
            entityId: po.id,
            action: "create",
            after: { ...poAudit(po), fromSalesOrder: so.number },
          });
          created.push(po);
        }
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "SalesOrder",
          entityId: so.id,
          action: "update",
          before: { purchaseOrders: null },
          after: { purchaseOrders: created.map((c) => c.number).join(", ") },
          diff: false,
        });
        return created;
      }, DOC_TX),
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new DocRuleError("Someone just put one of these lines on another PO. Reload and try again.");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Standalone create / edit
// ---------------------------------------------------------------------------

export async function createStandalonePurchaseOrder(input: PoInput, actor: PoActor): Promise<PoWithItems> {
  assertPoAccess(actor);
  const supplier = await checkSupplier(input.supplierId, input.supplierContactId);
  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.supplierPo;
  const year = input.date.getUTCFullYear();
  await ensureSeries(db, "PURCHASE_ORDER", year, format);
  const lines = input.items.map((i) => ({ ...i, salesOrderItemId: null }));
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const number = await allocateDocNumber(tx, "PURCHASE_ORDER", year, format);
      const po = await tx.purchaseOrder.create({
        data: {
          number,
          supplierId: supplier.id,
          supplierContactId: input.supplierContactId,
          salesOrderId: null,
          date: input.date,
          expectedDate: input.expectedDate,
          terms: input.terms,
          deliveryAddressText: input.deliveryAddressText ?? (snap.settings.company.address || null),
          supplierAddressText: input.supplierAddressText ?? (await supplierAddressText(supplier.id, tx)),
          notes: input.notes,
          settingsVersionId: snap.versionId,
          subtotal: subtotalOf(lines),
          createdById: actor.id,
          updatedById: actor.id,
          items: { create: lines.map((l, i) => itemCreate(l, i)) },
        },
        include: { items: true },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "PurchaseOrder", entityId: po.id, action: "create", after: poAudit(po) });
      return po;
    }, DOC_TX),
  );
}

/**
 * Edit a Draft or Approved PO. Editing an approved PO returns it to Draft,
 * clears the approval and bumps the revision (logged). Lines linked to SO
 * lines keep their link; removed lines free their SO line.
 */
export async function updatePurchaseOrder(id: string, input: PoInput, actor: PoActor): Promise<PoWithItems> {
  assertPoAccess(actor);
  const current = await db.purchaseOrder.findUnique({ where: { id } });
  if (!current) throw new DocRuleError("Purchase order not found.");
  if (input.supplierId !== current.supplierId) throw new DocRuleError("The supplier of a PO can't be changed. Void it and create a new one.", "supplierId");
  await checkSupplier(input.supplierId, input.supplierContactId, { allowInactiveId: current.supplierId });

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const before = await lockPurchaseOrder(tx, id);
      const err = poActionError(before.status, "edit");
      if (err) throw new DocRuleError(err);
      const existing = new Map(before.items.map((i) => [i.id, i]));
      for (const l of input.items) if (l.id && !existing.has(l.id)) throw new DocRuleError("One of the lines no longer exists. Reload and try again.", "items");
      const keep = new Set(input.items.map((l) => l.id).filter(Boolean));
      const removed = before.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
      if (removed.length) {
        await tx.purchaseOrderItem.updateMany({ where: { id: { in: removed }, purchaseOrderId: id }, data: { removedAt: new Date(), activeSalesOrderItemId: null } });
      }
      for (const [n, l] of input.items.entries()) {
        const data = { sortOrder: n, description: l.description, kind: l.kind, qty: l.qty, unit: l.unit, unitCost: l.unitCost, total: lineTotal(l.qty, l.unitCost) };
        if (l.id) await tx.purchaseOrderItem.update({ where: { id: l.id }, data });
        else await tx.purchaseOrderItem.create({ data: { ...data, purchaseOrderId: id } });
      }
      const next = afterEdit(before.status);
      const after = await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierContactId: input.supplierContactId,
          date: input.date,
          expectedDate: input.expectedDate,
          terms: input.terms,
          deliveryAddressText: input.deliveryAddressText,
          supplierAddressText: input.supplierAddressText,
          notes: input.notes,
          subtotal: subtotalOf(input.items),
          status: next.status,
          ...(next.clearsApproval ? { approvedById: null, approvedAt: null, revision: before.revision + 1 } : {}),
          updatedById: actor.id,
        },
        include: { items: { where: { removedAt: null } } },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "PurchaseOrder",
        entityId: id,
        action: "update",
        before: { ...poAudit(before), ...(next.clearsApproval ? { approval: "approved" } : {}) },
        after: { ...poAudit(after), ...(next.clearsApproval ? { approval: "cleared (edited after approval)" } : {}) },
      });
      return after;
    }, DOC_TX),
  );
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

async function transition(
  id: string,
  actor: PoActor,
  permission: Permission,
  check: (po: PoWithItems, tx: Tx) => Promise<string | null> | string | null,
  data: (po: PoWithItems) => Prisma.PurchaseOrderUpdateInput,
  extra: Record<string, unknown> = {},
) {
  assertPoAccess(actor, permission);
  return db.$transaction(async (tx) => {
    const before = await lockPurchaseOrder(tx, id);
    const err = await check(before, tx);
    if (err) throw new DocRuleError(err);
    const after = await tx.purchaseOrder.update({ where: { id }, data: { ...data(before), updatedBy: { connect: { id: actor.id } } } });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "PurchaseOrder",
      entityId: id,
      action: after.status === "VOID" ? "void" : "update",
      before: { status: before.status },
      after: { status: after.status, ...extra },
      diff: false,
    });
    return { before, after };
  });
}

/** Draft → Approved. Needs "approve"; creator never approves their own PO (even Admin). */
export async function approvePurchaseOrder(id: string, actor: PoActor) {
  const { after } = await transition(
    id,
    actor,
    "approve",
    (po) => poActionError(po.status, "approve") ?? approverError(actor, po.createdById),
    () => ({ status: "APPROVED", approvedBy: { connect: { id: actor.id } }, approvedAt: new Date() }),
    { approvedBy: "name" in actor && typeof actor.name === "string" ? actor.name : actor.id },
  );
  return after;
}

/**
 * Approved → Sent, or Draft → Sent when subtotal ≤ the PO's pinned Settings
 * `poTotalAbove` (new-documents-only: raising the live limit does not unlock
 * existing over-limit drafts). Skip-approval audit is written in the same txn.
 */
export async function markPurchaseOrderSent(id: string, actor: PoActor) {
  assertPoAccess(actor, "edit_data");
  return db.$transaction(async (tx) => {
    const before = await lockPurchaseOrder(tx, id);
    const snap =
      (await getSettingsVersion(before.settingsVersionId)) ?? (await getSettingsSnapshot());
    const limit = snap.settings.approval.poTotalAbove;
    const needs = poNeedsApproval(money(before.subtotal), limit);
    const err = poMarkSentError(before.status, needs);
    if (err) throw new DocRuleError(err);
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), updatedBy: { connect: { id: actor.id } } },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "PurchaseOrder",
      entityId: id,
      action: "update",
      before: { status: before.status },
      after: { status: after.status },
      diff: false,
    });
    // Under/at the pinned limit: Draft → Sent skips approval; log reason + numbers
    // in the same transaction as the status change.
    if (before.status === "DRAFT" && !needs) {
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "PurchaseOrder",
        entityId: id,
        action: "update",
        before: { approval: "not required" },
        after: {
          approval: "skipped (at or below limit)",
          subtotal: money(before.subtotal),
          poTotalAbove: Number(limit).toFixed(2),
        },
        diff: false,
      });
    }
    return after;
  });
}

/** Received → Closed, or short-close a partially received PO (reason required). */
export async function closePurchaseOrder(id: string, reason: string | null, actor: PoActor) {
  const r = (reason ?? "").trim() || null;
  const { after } = await transition(
    id,
    actor,
    "edit_data",
    (po) => closeError(po.status, r),
    () => ({ status: "CLOSED", closedAt: new Date(), closeReason: r }),
    r ? { closeReason: r } : {},
  );
  return after;
}

/** Void (reason) a Draft/Approved/Sent PO with no posted receiving report. Frees its SO lines. */
export async function voidPurchaseOrder(id: string, reason: string, actor: PoActor) {
  assertPoAccess(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");
  return db.$transaction(async (tx) => {
    const before = await lockPurchaseOrder(tx, id);
    const posted = await tx.receivingReport.count({ where: { purchaseOrderId: id, status: "POSTED" } });
    const err = voidError(before.status, posted);
    if (err) throw new DocRuleError(err);
    const now = new Date();
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: "VOID", voidedAt: now, voidReason: why, updatedById: actor.id } });
    // Free the SO lines so they can go on a new PO.
    await tx.purchaseOrderItem.updateMany({ where: { purchaseOrderId: id }, data: { activeSalesOrderItemId: null } });
    await tx.documentVoid.create({
      data: {
        docType: "PURCHASE_ORDER",
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
      entityType: "PurchaseOrder",
      entityId: id,
      action: "void",
      before: { status: before.status },
      after: { status: "VOID", voidReason: why },
      diff: false,
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Email draft (never sends)
// ---------------------------------------------------------------------------

export type EmailDraft = { to: string | null; toName: string | null; subject: string; body: string };

export async function buildPoEmailDraft(id: string, actor: PoActor): Promise<EmailDraft> {
  assertPoAccess(actor);
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { supplier: { include: { contacts: true } }, supplierContact: true } });
  if (!po) throw new DocRuleError("Purchase order not found.");
  // Approval gate uses the PO's pinned settings version (new documents only).
  const pinned =
    (await getSettingsVersion(po.settingsVersionId)) ?? (await getSettingsSnapshot());
  const needs = poNeedsApproval(money(po.subtotal), pinned.settings.approval.poTotalAbove);
  const err =
    po.status === "VOID"
      ? "A void PO can't be emailed."
      : po.status === "DRAFT" && needs
        ? "Approve the PO before emailing it."
        : null;
  if (err) throw new DocRuleError(err);
  const main = po.supplier.contacts.find((c) => c.isMain && c.active);
  const contact = po.supplierContact?.email ? po.supplierContact : main;
  const total = Number(po.subtotal).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Letterhead name follows current Company settings (same as print).
  const { settings } = await getSettingsSnapshot();
  const draft: EmailDraft = {
    to: contact?.email ?? null,
    toName: contact?.name ?? null,
    subject: `Purchase Order ${po.number}`,
    body: [
      contact?.name ? `Dear ${contact.name},` : "Good day,",
      "",
      `Please find attached our purchase order ${po.number} for a total of PHP ${total}.`,
      `${po.expectedDate ? `We expect delivery by ${ymd(po.expectedDate)}. ` : ""}${po.terms ? `Terms: ${po.terms}.` : ""}`.trim(),
      po.deliveryAddressText ? `\nDeliver to:\n${po.deliveryAddressText}` : "",
      "",
      "[Attachment: save the PO as PDF from Actions → Print / Save PDF and attach it before sending.]",
      "",
      "Kindly confirm receipt of this order. Thank you.",
      "",
      settings.company.name,
    ]
      .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
      .join("\n"),
  };
  await writeAudit(db, { userId: actor.id, entityType: "PurchaseOrder", entityId: id, action: "email_draft", after: { to: draft.to, subject: draft.subject }, diff: false });
  return draft;
}

export const todayForPo = () => manilaToday();
export type { PoStatus };
