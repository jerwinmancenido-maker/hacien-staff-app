import { writeAudit } from "../audit";
import { db, type Tx } from "../db";
import { assertCan, can, type PermissionUser } from "../permissions";

/**
 * Business entities (Reconciliation Plan 2026-11-19, PR-A).
 *
 * The app's own company (HACIEN) is the implicit default and is NOT a row in
 * this catalogue — documents carry `businessId = NULL` for it. A Business row
 * is another business whose transactions Jerwin records here for operations;
 * its documents stay out of HACIEN's sales, Books and tax (the wall itself
 * lands in PR-B; PR-A adds the catalogue, the tagging and the billing block).
 * Rows are never hard-deleted (no-delete design): deactivate instead.
 */
export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export type BusinessActor = PermissionUser & { id: string };

export type BusinessRow = {
  id: string;
  name: string;
  shortLabel: string;
  active: boolean;
  sortOrder: number;
};

export async function listBusinesses(opts: { activeOnly?: boolean } = {}): Promise<BusinessRow[]> {
  return db.business.findMany({
    where: opts.activeOnly ? { active: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, shortLabel: true, active: true, sortOrder: true },
  });
}

/** Create or rename a catalogue entry. Settings managers only. */
export async function saveBusiness(
  input: { id?: string; name: string; shortLabel: string },
  actor: BusinessActor,
): Promise<BusinessRow> {
  assertCan(actor, "manage_settings");
  const name = input.name.trim();
  const shortLabel = input.shortLabel.trim();
  if (!name) throw new BusinessRuleError("Give the business a name.", "name");
  if (!shortLabel) throw new BusinessRuleError("Give the business a short label (it appears on lists).", "shortLabel");
  const clash = await db.business.findFirst({
    where: { name: { equals: name }, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) throw new BusinessRuleError("A business with that name is already in the list.", "name");
  if (input.id) {
    const row = await db.business.update({
      where: { id: input.id },
      data: { name, shortLabel },
      select: { id: true, name: true, shortLabel: true, active: true, sortOrder: true },
    });
    await writeAudit(db, { userId: actor.id, entityType: "Business", entityId: row.id, action: "update", after: { name, shortLabel } });
    return row;
  }
  const count = await db.business.count();
  const row = await db.business.create({
    data: { name, shortLabel, sortOrder: count },
    select: { id: true, name: true, shortLabel: true, active: true, sortOrder: true },
  });
  await writeAudit(db, { userId: actor.id, entityType: "Business", entityId: row.id, action: "create", after: { name, shortLabel } });
  return row;
}

/** Deactivate / reactivate. Never a delete: existing records keep the label. */
export async function setBusinessActive(id: string, active: boolean, actor: BusinessActor): Promise<void> {
  assertCan(actor, "manage_settings");
  const row = await db.business.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!row) throw new BusinessRuleError("That business no longer exists.");
  await db.business.update({ where: { id }, data: { active } });
  await writeAudit(db, { userId: actor.id, entityType: "Business", entityId: id, action: "update", after: { active } });
}

/**
 * Validate a businessId a write path wants to store. NULL means the own
 * company and is always fine. A non-null id must exist and be active, and
 * only an Admin or Approver may tag a transaction to another business
 * (Jerwin's rule, 2026-11-19 — keeps Staff from mislabelling by accident).
 * Returns the id to store.
 */
export async function resolveBusinessForWrite(
  client: Tx | typeof db,
  businessId: string | null | undefined,
  actor: BusinessActor,
): Promise<string | null> {
  if (!businessId) return null;
  if (!can(actor, "approve")) {
    throw new BusinessRuleError("Only an Admin or Approver can tag a transaction to another business.", "businessId");
  }
  const row = await client.business.findUnique({ where: { id: businessId }, select: { id: true, active: true } });
  if (!row) throw new BusinessRuleError("That business no longer exists — pick another.", "businessId");
  if (!row.active) throw new BusinessRuleError("That business is switched off in Settings — pick another.", "businessId");
  return row.id;
}

/** Display name for a document's business; NULL business = the own company name. */
export function businessDisplayName(
  business: { name: string } | null | undefined,
  ownCompanyName: string,
): string {
  return business?.name ?? ownCompanyName;
}

/**
 * Admin reclassify: move a sales order (and everything that hangs off it)
 * to another business, or back to the own company (businessId = null).
 * Refused once the order has any live billing — billed history stays where
 * it was recorded; void the billing first. The order's POs and its linked
 * expenses follow in the same transaction, and the change is audit-logged
 * on the SO in that same transaction.
 */
export async function reclassifySalesOrderBusiness(
  salesOrderId: string,
  businessId: string | null,
  actor: BusinessActor,
): Promise<void> {
  if (!actor.isAdmin) throw new BusinessRuleError("Only an Admin can change which business an order belongs to.");
  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true, number: true, businessId: true, business: { select: { name: true } } },
  });
  if (!so) throw new BusinessRuleError("Sales order not found.");
  if (so.businessId === businessId) return;
  const target = businessId
    ? await db.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, active: true } })
    : null;
  if (businessId && !target) throw new BusinessRuleError("That business no longer exists — pick another.", "businessId");
  if (target && !target.active) throw new BusinessRuleError("That business is switched off in Settings — pick another.", "businessId");

  await db.$transaction(async (tx) => {
    const billed = await tx.billing.count({ where: { salesOrderId, status: { not: "VOID" } } });
    if (billed > 0) {
      throw new BusinessRuleError(
        `${so.number} already has billing recorded, so its business can't change. Void the billing first if this is a correction.`,
      );
    }
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { businessId } });
    await tx.purchaseOrder.updateMany({ where: { salesOrderId }, data: { businessId } });
    // Expenses follow via their SO link OR via a PO of this SO (an expense
    // linked only to a PO has salesOrderId = null but inherited the tag).
    const poIds = (await tx.purchaseOrder.findMany({ where: { salesOrderId }, select: { id: true } })).map((p) => p.id);
    await tx.expense.updateMany({
      where: { OR: [{ salesOrderId }, ...(poIds.length ? [{ purchaseOrderId: { in: poIds } }] : [])] },
      data: { businessId },
    });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "SalesOrder",
      entityId: salesOrderId,
      action: "update",
      before: { business: so.business?.name ?? null },
      after: { business: target?.name ?? null },
    });
  });
}
