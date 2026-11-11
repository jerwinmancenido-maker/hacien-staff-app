// Supplier purchase orders: create from a sales order (one PO per supplier) or
// standalone, edit (Draft/Approved only), approve, mark sent, close, void,
// email draft. Every function checks permissions itself: PO data is cost data,
// so all of these need "Can see costs" on top of the role permission. Each
// change runs in one transaction with its audit row; nothing is deleted.

import type { Prisma, PurchaseOrder, PurchaseOrderItem } from "@prisma/client";
import { db, isUniqueViolation, type Tx } from "../db";
import { writeAudit } from "../audit";
import { manilaToday } from "../format";
import { assertCan, assertCanMaintainPurchaseOrder, assertCanVoid, canSeeCosts, ForbiddenError, type Permission, type PermissionUser } from "../permissions";
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
import { loadOrderedQty } from "../purchasing/ordered";
import { overOrder } from "../purchasing/picker";
import {
  planPoSelection,
  planPurchaseOrders,
  qtyLeft,
  selectionIssueSummary,
  type PlannedPoLine,
  type PoSelectionInput,
  type PoSelectionIssue,
} from "../purchasing/plan";
import type { CreateFromSoInput, PoInput, PoLineInput } from "../validation/purchasing";
import { voidReasonSchema } from "../validation/quotes";
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

const itemCreate = (
  l: PlannedPoLine | (PoLineInput & { salesOrderItemId?: string | null; salesOrderItemComponentId?: string | null }),
  sortOrder: number,
  /**
   * Take the unique live-claim slot (`activeSalesOrderItem*`). Remainder lines
   * pass false: they still set the non-unique salesOrderItem* link, so a
   * second PO can buy what's left without a schema change.
   */
  claim = true,
) => {
  const componentId = "salesOrderItemComponentId" in l && l.salesOrderItemComponentId ? l.salesOrderItemComponentId : null;
  const lineId = l.salesOrderItemId ?? null;
  return {
    sortOrder,
    description: l.description,
    kind: l.kind,
    qty: l.qty,
    unit: l.unit,
    unitCost: l.unitCost,
    total: lineTotal(l.qty, l.unitCost),
    salesOrderItemId: lineId,
    activeSalesOrderItemId: !componentId && claim ? lineId : null,
    salesOrderItemComponentId: componentId,
    activeSalesOrderItemComponentId: componentId && claim ? componentId : null,
  };
};

function claimFlags(lines: readonly PlannedPoLine[], claimedLines: Set<string>, claimedComps: Set<string>): boolean[] {
  return lines.map((l) => {
    if (l.salesOrderItemComponentId) {
      if (claimedComps.has(l.salesOrderItemComponentId)) return false;
      claimedComps.add(l.salesOrderItemComponentId);
      return true;
    }
    if (!l.salesOrderItemId) return false;
    if (claimedLines.has(l.salesOrderItemId)) return false;
    claimedLines.add(l.salesOrderItemId);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Create from a sales order
// ---------------------------------------------------------------------------

/** SO line ids already on a live (non-void, not removed) PO line. */
export async function orderedSoLineIds(soLineIds: readonly string[], client: Tx | typeof db = db): Promise<Set<string>> {
  if (!soLineIds.length) return new Set();
  const rows = await client.purchaseOrderItem.findMany({ where: { activeSalesOrderItemId: { in: [...soLineIds] } }, select: { activeSalesOrderItemId: true } });
  return new Set(rows.map((r) => r.activeSalesOrderItemId!));
}

/** Lot component ids already on a live (non-void, not removed) PO line. */
export async function orderedSoComponentIds(componentIds: readonly string[], client: Tx | typeof db = db): Promise<Set<string>> {
  if (!componentIds.length) return new Set();
  const rows = await client.purchaseOrderItem.findMany({
    where: { activeSalesOrderItemComponentId: { in: [...componentIds] } },
    select: { activeSalesOrderItemComponentId: true },
  });
  return new Set(rows.map((r) => r.activeSalesOrderItemComponentId!));
}

type SoPoItem = {
  id: string;
  isLot: boolean;
  sortOrder: number;
  description: string;
  kind: PlannedPoLine["kind"];
  qty: { toFixed(n: number): string };
  unit: string;
  supplierId: string | null;
  supplierUnitCost: { toFixed(n: number): string };
  components: {
    id: string;
    sortOrder: number;
    description: string;
    qty: { toFixed(n: number): string };
    unit: string;
    supplierId: string | null;
    unitCost: { toFixed(n: number): string };
  }[];
};

type SupplierChoice = {
  key: string;
  salesOrderItemId: string;
  salesOrderItemComponentId: string | null;
  description: string;
  quoteSupplierId: string | null;
  supplierId: string;
  overridden: boolean;
  wasNoSupplier: boolean;
  qty: string;
  unitCost: string;
  zeroCostConfirmed: boolean;
};

function throwIssues(message: string, issues: readonly PoSelectionIssue[]): never {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = `${issue.field}:${issue.key}`;
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new DocRuleError(message, undefined, fields);
}

function choiceFromLine(line: PlannedPoLine & { confirmZero?: boolean }, supplierId: string, quoteSupplierId: string | null): SupplierChoice {
  return {
    key: line.salesOrderItemComponentId ?? line.salesOrderItemId,
    salesOrderItemId: line.salesOrderItemId,
    salesOrderItemComponentId: line.salesOrderItemComponentId ?? null,
    description: line.description,
    quoteSupplierId,
    supplierId,
    overridden: (quoteSupplierId ?? null) !== supplierId,
    wasNoSupplier: !quoteSupplierId,
    qty: line.qty,
    unitCost: line.unitCost,
    zeroCostConfirmed: !!line.confirmZero,
  };
}

function quoteSupplierFor(items: readonly SoPoItem[], line: PlannedPoLine): string | null {
  if (line.salesOrderItemComponentId) {
    for (const item of items) {
      const component = item.components.find((c) => c.id === line.salesOrderItemComponentId);
      if (component) return component.supplierId;
    }
    return null;
  }
  return items.find((item) => item.id === line.salesOrderItemId)?.supplierId ?? null;
}

/**
 * One Draft PO per final supplier from an open sales order, in one transaction.
 * With `rows`, only the ticked lines are ordered (supplier required, qty capped
 * at the live remainder, ₱0 cost confirmed per line). Without `rows`, the
 * legacy call orders every open line at its remaining qty and skips lines
 * that still have no supplier. Nothing is written back to the SO or the quote.
 * The same idempotency key returns the POs already created.
 */
export async function createPurchaseOrdersFromSalesOrder(salesOrderId: string, input: CreateFromSoInput, actor: PoActor) {
  assertCanMaintainPurchaseOrder(actor);
  assertPoAccess(actor);
  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.supplierPo;
  const year = input.date.getUTCFullYear();
  const idempotencyKey = input.idempotencyKey && /^[A-Za-z0-9_-]{8,64}$/.test(input.idempotencyKey) ? input.idempotencyKey : undefined;
  const picked = [...new Set(Object.values(input.supplierPicks).filter((v): v is string => !!v))];
  if (!input.rows && picked.length) {
    const n = await db.supplier.count({ where: { id: { in: picked }, active: true } });
    if (n !== picked.length) throw new DocRuleError("One of the picked suppliers is inactive or no longer exists.", "supplierPicks");
  }
  await ensureSeries(db, "PURCHASE_ORDER", year, format);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        // Lock the SO so two creates (and a double submit of the same key) queue up.
        await tx.$queryRaw`SELECT \`id\` FROM \`SalesOrder\` WHERE \`id\` = ${salesOrderId} FOR UPDATE`;
        if (idempotencyKey) {
          // No fixed window: a capped scan would silently miss the key once
          // an SO collects more update audits than the cap, and a missed key
          // means a duplicate set of POs. The scan is bounded by this SO's
          // own audit history and exits on the first match.
          const prior = await tx.auditLog.findMany({
            where: { entityType: "SalesOrder", entityId: salesOrderId, action: "update" },
            orderBy: { at: "desc" },
          });
          for (const audit of prior) {
            const after = audit.after;
            if (!after || typeof after !== "object" || Array.isArray(after)) continue;
            const rec = after as { idempotencyKey?: unknown; purchaseOrderIds?: unknown };
            if (rec.idempotencyKey !== idempotencyKey) continue;
            if (!Array.isArray(rec.purchaseOrderIds) || !rec.purchaseOrderIds.every((id) => typeof id === "string")) break;
            const ids = rec.purchaseOrderIds;
            const existing = await tx.purchaseOrder.findMany({
              where: { id: { in: ids }, salesOrderId, status: { not: "VOID" } },
              include: { items: true },
            });
            if (existing.length !== ids.length) break;
            const byId = new Map(existing.map((po) => [po.id, po]));
            return ids.map((id) => byId.get(id)!);
          }
        }
        const so = await tx.salesOrder.findUnique({
          where: { id: salesOrderId },
          include: {
            quote: { select: { status: true } },
            items: {
              where: { removedAt: null },
              include: { components: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
            },
          },
        });
        if (!so) throw new DocRuleError("Sales order not found.");
        if (so.status !== "OPEN") throw new DocRuleError("POs can only be created from an open sales order.");
        if (so.quote.status !== "WON") throw new DocRuleError("The sales order's quote isn't Won.");

        const items = so.items as SoPoItem[];
        const lineIds = items.filter((item) => !item.isLot).map((item) => item.id);
        const componentIds = items.flatMap((item) => item.components.map((c) => c.id));
        const ordered = await loadOrderedQty(lineIds, componentIds, tx);
        const orderedQty = Object.fromEntries(lineIds.map((id) => [id, ordered.lines.get(id)?.qty ?? "0.00"]));
        const orderedComponentQty = Object.fromEntries(componentIds.map((id) => [id, ordered.components.get(id)?.qty ?? "0.00"]));

        let groups: { supplierId: string; lines: (PlannedPoLine & { confirmZero?: boolean })[] }[];
        if (input.rows) {
          const seen = new Set<string>();
          const selection: PoSelectionInput[] = [];
          const issues: PoSelectionIssue[] = [];
          for (const row of input.rows) {
            if (seen.has(row.key)) {
              issues.push({ key: row.key, field: "qty", code: "unknown", message: "This line is listed twice." });
              continue;
            }
            seen.add(row.key);
            const plain = items.find((item) => !item.isLot && item.id === row.key);
            const lot = items.find((item) => item.isLot && item.id === row.key);
            const componentParent = items.find((item) => item.components.some((c) => c.id === row.key));
            const component = componentParent?.components.find((c) => c.id === row.key);
            if (lot) {
              issues.push({ key: row.key, field: "qty", code: "unknown", message: "Order the components of a lot, not the lot itself." });
              continue;
            }
            if (!plain && !component) {
              issues.push({ key: row.key, field: "qty", code: "unknown", message: "This line is not on this sales order." });
              continue;
            }
            if (plain) {
              selection.push({
                key: plain.id,
                salesOrderItemId: plain.id,
                salesOrderItemComponentId: null,
                description: plain.description,
                kind: plain.kind,
                qty: row.qty,
                unit: plain.unit,
                unitCost: money(plain.supplierUnitCost),
                supplierId: row.supplierId || null,
                quoteSupplierId: plain.supplierId,
                sortOrder: plain.sortOrder * 1000,
                confirmZero: !!row.confirmZero,
                remainingQty: qtyLeft(money(plain.qty), orderedQty[plain.id] ?? "0.00"),
              });
            } else if (component && componentParent) {
              selection.push({
                key: component.id,
                salesOrderItemId: componentParent.id,
                salesOrderItemComponentId: component.id,
                description: component.description,
                kind: componentParent.kind,
                qty: row.qty,
                unit: component.unit,
                unitCost: money(component.unitCost),
                supplierId: row.supplierId || null,
                quoteSupplierId: component.supplierId,
                sortOrder: componentParent.sortOrder * 1000 + component.sortOrder,
                lotDescription: componentParent.description,
                confirmZero: !!row.confirmZero,
                remainingQty: qtyLeft(money(component.qty), orderedComponentQty[component.id] ?? "0.00"),
              });
            }
          }
          const plan = planPoSelection(selection);
          issues.push(...plan.issues);
          const supplierIds = [...new Set(selection.map((row) => row.supplierId).filter((id): id is string => !!id))];
          const known = supplierIds.length
            ? await tx.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, active: true } })
            : [];
          const names = new Map(known.map((s) => [s.id, s.name]));
          for (const row of selection) {
            if (!row.supplierId) continue;
            const supplier = known.find((s) => s.id === row.supplierId);
            if (!supplier || !supplier.active) {
              issues.push({
                key: row.key,
                field: "supplier",
                code: "inactive",
                message: `Pick an active supplier — ${supplier?.name ?? "that supplier"} is no longer active`,
              });
            }
          }
          if (!input.rows.length) throw new DocRuleError("Tick at least one line to order.");
          if (issues.length) {
            const onlyInactive = issues.every((issue) => issue.code === "inactive");
            const first = issues.find((issue) => issue.code === "inactive");
            const line = selection.find((row) => row.key === first?.key);
            const supplierName = (line?.supplierId && names.get(line.supplierId)) || "that supplier";
            const message = onlyInactive
              ? `Couldn't create the draft POs. Supplier ${supplierName} was deactivated while you were reviewing (line: ${line?.description ?? "a selected line"}). Nothing was saved — your selection below is unchanged.`
              : issues.length === 1
                ? issues[0]!.message
                : selectionIssueSummary(issues, "create");
            throwIssues(message, issues);
          }
          groups = plan.pos.map((po) => ({ supplierId: po.supplierId, lines: po.lines }));
        } else {
          const plan = planPurchaseOrders(
            items.map((item) => ({
              ...item,
              qty: money(item.qty),
              supplierUnitCost: money(item.supplierUnitCost),
              components: item.components.map((c) => ({
                id: c.id,
                sortOrder: c.sortOrder,
                description: c.description,
                qty: money(c.qty),
                unit: c.unit,
                supplierId: c.supplierId,
                unitCost: money(c.unitCost),
              })),
            })),
            new Set(),
            input.supplierPicks,
            input.lineIds ? new Set(input.lineIds) : undefined,
            new Set(),
            input.excludeComponentIds ? new Set(input.excludeComponentIds) : undefined,
            { orderedQty, orderedComponentQty },
          );
          if (!plan.pos.length) {
            throw new DocRuleError(
              plan.needsSupplier.length ? "Pick a supplier for at least one line." : "Every line of this sales order is already on a PO.",
            );
          }
          groups = plan.pos;
        }

        if (!groups.length) throw new DocRuleError("Tick at least one line to order.");
        const supplierIds = groups.map((p) => p.supplierId);
        const suppliers = await tx.supplier.findMany({ where: { id: { in: supplierIds } }, include: { contacts: { where: { active: true } } } });
        for (const id of supplierIds) {
          const supplier = suppliers.find((s) => s.id === id);
          if (!supplier || !supplier.active) {
            throw new DocRuleError(`Pick an active supplier — ${supplier?.name ?? "that supplier"} is no longer active.`, "supplierPicks");
          }
        }
        const claimedLines = await orderedSoLineIds(items.map((item) => item.id), tx);
        const claimedComps = await orderedSoComponentIds(componentIds, tx);
        const choices: SupplierChoice[] = [];
        const created: PoWithItems[] = [];
        for (const p of groups) {
          const supplier = suppliers.find((s) => s.id === p.supplierId)!;
          const poChoices = p.lines.map((line) => choiceFromLine(line, p.supplierId, quoteSupplierFor(items, line)));
          choices.push(...poChoices);
          const claims = claimFlags(p.lines, claimedLines, claimedComps);
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
              items: { create: p.lines.map((l, i) => itemCreate(l, i, claims[i])) },
            },
            include: { items: true },
          });
          await writeAudit(tx, {
            userId: actor.id,
            entityType: "PurchaseOrder",
            entityId: po.id,
            action: "create",
            after: {
              ...poAudit(po),
              fromSalesOrder: so.number,
              draftsOnly: true,
              idempotencyKey: idempotencyKey ?? null,
              supplierChoices: poChoices,
            },
          });
          created.push(po);
        }
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "SalesOrder",
          entityId: so.id,
          action: "update",
          before: { purchaseOrders: null },
          after: {
            purchaseOrders: created.map((c) => c.number).join(", "),
            purchaseOrderIds: created.map((c) => c.id),
            idempotencyKey: idempotencyKey ?? null,
            draftsOnly: true,
            supplierChoices: choices,
          },
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
  assertCanMaintainPurchaseOrder(actor);
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
  assertCanMaintainPurchaseOrder(actor);
  assertPoAccess(actor);
  const current = await db.purchaseOrder.findUnique({ where: { id } });
  if (!current) throw new DocRuleError("Purchase order not found.");
  if (input.supplierId !== current.supplierId) throw new DocRuleError("The supplier of a PO can't be changed. Void it and create a new one.", "supplierId");
  await checkSupplier(input.supplierId, input.supplierContactId, { allowInactiveId: current.supplierId });

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      // Part B (audit B1): lock the sales order row BEFORE the PO, so a
      // picker save and an SO edit (or a second PO's picker save) cannot
      // interleave — remaining qty is re-checked under both locks.
      if (current.salesOrderId) {
        await tx.$queryRaw`SELECT \`id\` FROM \`SalesOrder\` WHERE \`id\` = ${current.salesOrderId} FOR UPDATE`;
      }
      const before = await lockPurchaseOrder(tx, id);
      const err = poActionError(before.status, "edit");
      if (err) throw new DocRuleError(err);
      const existing = new Map(before.items.map((i) => [i.id, i]));
      for (const l of input.items) if (l.id && !existing.has(l.id)) throw new DocRuleError("One of the lines no longer exists. Reload and try again.", "items");

      // Part B: "Add from sales order" — link ids arrive on NEW lines only
      // (audit B2). Each is re-checked against THIS PO's sales order under
      // the locks above: it must belong to that SO, its supplier must be the
      // PO's supplier or none, and it must not already sit on this PO.
      // Quantity past the remaining qty is NOT refused (Jerwin's settlement:
      // deliberate extras) — it is recorded in the audit row as over-order.
      type AddedFromSo = {
        description: string;
        salesOrderItemId: string | null;
        salesOrderItemComponentId: string | null;
        wasNoSupplier: boolean;
        overOrder: { qty: string; remainingQty: string } | null;
      };
      const addedFromSo: AddedFromSo[] = [];
      const claimByKey = new Map<string, boolean>();
      const newLinked = input.items.filter((l) => !l.id && (l.salesOrderItemId || l.salesOrderItemComponentId));
      if (newLinked.length) {
        const soId = current.salesOrderId;
        if (!soId) throw new DocRuleError("This purchase order is not from a sales order, so its lines can't link to one.", "items");
        const so = await tx.salesOrder.findUnique({
          where: { id: soId },
          select: {
            status: true,
            items: {
              where: { removedAt: null },
              select: {
                id: true, description: true, qty: true, supplierId: true,
                components: { where: { removedAt: null }, select: { id: true, description: true, qty: true, supplierId: true } },
              },
            },
          },
        });
        if (!so) throw new DocRuleError("The sales order behind this PO no longer exists.", "items");
        if (so.status !== "OPEN") throw new DocRuleError("That sales order is closed, so no more lines can be added from it.", "items");
        const soLineById = new Map(so.items.map((i) => [i.id, i]));
        const soCompById = new Map(so.items.flatMap((i) => i.components.map((c) => [c.id, c] as const)));
        const onThisPo = new Set(
          before.items.flatMap((i) => [i.salesOrderItemId, i.salesOrderItemComponentId]).filter((x): x is string => !!x),
        );
        const ordered = await loadOrderedQty([...soLineById.keys()], [...soCompById.keys()], tx);
        const claimedLines = await orderedSoLineIds([...soLineById.keys()], tx);
        const claimedComps = await orderedSoComponentIds([...soCompById.keys()], tx);
        const seenKeys = new Set<string>();
        for (const l of newLinked) {
          const key = (l.salesOrderItemComponentId ?? l.salesOrderItemId)!;
          if (seenKeys.has(key) || onThisPo.has(key)) {
            throw new DocRuleError(`"${l.description.split("\n")[0]}" is already on this purchase order — change its quantity instead.`, "items");
          }
          seenKeys.add(key);
          const src = l.salesOrderItemComponentId ? soCompById.get(key) : soLineById.get(key);
          if (!src) throw new DocRuleError(`"${l.description.split("\n")[0]}" is not a line of this PO's sales order.`, "items");
          if (src.supplierId && src.supplierId !== current.supplierId) {
            throw new DocRuleError(`"${l.description.split("\n")[0]}" belongs to a different supplier — it needs its own purchase order.`, "items");
          }
          const bucket = l.salesOrderItemComponentId ? ordered.components.get(key) : ordered.lines.get(key);
          const remainingQty = qtyLeft(money(src.qty), bucket?.qty ?? "0.00");
          addedFromSo.push({
            description: l.description,
            salesOrderItemId: l.salesOrderItemId ?? null,
            salesOrderItemComponentId: l.salesOrderItemComponentId ?? null,
            wasNoSupplier: !src.supplierId,
            overOrder: overOrder(l.qty, remainingQty) ? { qty: l.qty, remainingQty } : null,
          });
          // The unique claim goes to the first live PO line; a later PO's
          // line still links (non-unique columns) without the claim (S5/B3).
          claimByKey.set(key, l.salesOrderItemComponentId ? !claimedComps.has(key) : !claimedLines.has(key));
        }
      }
      // A link on an EXISTING line may not be added, moved or dropped here —
      // links are set when the line is created (B2). Callers that omit the
      // link fields entirely (payloads built before Part B) are not
      // asserting a change — the stored link stands; only an explicitly
      // different value (including an explicit null) is a change attempt.
      for (const l of input.items) {
        if (!l.id) continue;
        const cur = existing.get(l.id)!;
        const lineChanged = l.salesOrderItemId !== undefined && l.salesOrderItemId !== cur.salesOrderItemId;
        const compChanged = l.salesOrderItemComponentId !== undefined && l.salesOrderItemComponentId !== cur.salesOrderItemComponentId;
        if (lineChanged || compChanged) {
          throw new DocRuleError("A line's sales-order link can't be changed. Remove the line and add it again instead.", "items");
        }
      }

      const keep = new Set(input.items.map((l) => l.id).filter(Boolean));
      const removed = before.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
      if (removed.length) {
        await tx.purchaseOrderItem.updateMany({
          where: { id: { in: removed }, purchaseOrderId: id },
          data: { removedAt: new Date(), activeSalesOrderItemId: null, activeSalesOrderItemComponentId: null },
        });
      }
      for (const [n, l] of input.items.entries()) {
        const data = { sortOrder: n, description: l.description, kind: l.kind, qty: l.qty, unit: l.unit, unitCost: l.unitCost, total: lineTotal(l.qty, l.unitCost) };
        if (l.id) await tx.purchaseOrderItem.update({ where: { id: l.id }, data });
        else if (l.salesOrderItemId || l.salesOrderItemComponentId) {
          const key = (l.salesOrderItemComponentId ?? l.salesOrderItemId)!;
          const linked = itemCreate(l, n, claimByKey.get(key) ?? false);
          await tx.purchaseOrderItem.create({
            data: {
              purchaseOrderId: id,
              sortOrder: n,
              description: l.description,
              kind: l.kind,
              qty: l.qty,
              unit: l.unit,
              unitCost: l.unitCost,
              total: linked.total,
              salesOrderItemId: linked.salesOrderItemId,
              activeSalesOrderItemId: linked.activeSalesOrderItemId,
              salesOrderItemComponentId: linked.salesOrderItemComponentId,
              activeSalesOrderItemComponentId: linked.activeSalesOrderItemComponentId,
            },
          });
        } else await tx.purchaseOrderItem.create({ data: { ...data, purchaseOrderId: id } });
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
        after: {
          ...poAudit(after),
          ...(next.clearsApproval ? { approval: "cleared (edited after approval)" } : {}),
          // Part B (audit B5): picker-added lines carry the create-shaped
          // record — which SO line, whether it had no supplier, and whether
          // the qty deliberately went past what the SO still needs.
          ...(addedFromSo.length ? { addedFromSalesOrder: addedFromSo } : {}),
        },
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

/** Draft → Approved. Needs "approve"; Approver may not self-approve, Admin may. */
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
    // Missing/unresolvable pin → needs approval (fail closed; do not use latest Settings).
    const snap = await getSettingsVersion(before.settingsVersionId);
    const needs =
      !snap || poNeedsApproval(money(before.subtotal), snap.settings.approval.poTotalAbove);
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
    if (before.status === "DRAFT" && snap && !needs) {
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "PurchaseOrder",
        entityId: id,
        action: "update",
        before: { approval: "not required" },
        after: {
          approval: "skipped (at or below limit)",
          subtotal: money(before.subtotal),
          poTotalAbove: Number(snap.settings.approval.poTotalAbove).toFixed(2),
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
  assertCanVoid(actor);
  if (!canSeeCosts(actor)) throw new ForbiddenError();
  const parsedReason = voidReasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    throw new DocRuleError(parsedReason.error.issues[0]?.message ?? "A reason is required.", "reason");
  }
  const why = parsedReason.data;
  return db.$transaction(async (tx) => {
    const before = await lockPurchaseOrder(tx, id);
    const posted = await tx.receivingReport.count({ where: { purchaseOrderId: id, status: "POSTED" } });
    const err = voidError(before.status, posted);
    if (err) throw new DocRuleError(err);
    const now = new Date();
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: "VOID", voidedAt: now, voidReason: why, updatedById: actor.id } });
    // Free the SO lines so they can go on a new PO.
    await tx.purchaseOrderItem.updateMany({
      where: { purchaseOrderId: id },
      data: { activeSalesOrderItemId: null, activeSalesOrderItemComponentId: null },
    });
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
  // Missing/unresolvable pin → needs approval (fail closed; do not use latest Settings).
  const pinned = await getSettingsVersion(po.settingsVersionId);
  const needs = !pinned || poNeedsApproval(money(po.subtotal), pinned.settings.approval.poTotalAbove);
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
