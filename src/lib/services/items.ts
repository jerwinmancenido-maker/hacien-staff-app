import { writeAudit } from "../audit";
import { db, type Tx } from "../db";
import type { ItemInput } from "../validation/items";

export class ItemRuleError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "ItemRuleError";
  }
}

/** Item catalog, Step 1 (Option A). History rows stay unlinked until Step 2. */

/**
 * SKUs are unique across the catalog (no DB constraint — enforced here, the
 * one write path for the catalog form). Blank SKU is fine; a used SKU refuses
 * and names the item that owns it, mirroring the TIN rule for customers.
 */
async function assertSkuFree(tx: Tx, sku: string | null, exceptId: string | null) {
  if (!sku) return;
  // Plain equality: MySQL's ci collation matches SKUs case-insensitively
  // (the same reliance as the CSV import's existing-SKU lookup).
  const other = await tx.item.findFirst({
    where: { sku: { equals: sku }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { name: true },
  });
  if (other) throw new ItemRuleError(`SKU ${sku} is already used by ${other.name}.`, "sku");
}

export async function listItems({
  q,
  includeInactive = false,
  skip,
  take,
}: {
  q?: string;
  includeInactive?: boolean;
  /** Page window for /api/v1. The staff UI omits these. */
  skip?: number;
  take?: number;
}) {
  const query = (q ?? "").trim();
  return db.item.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(query
        ? {
            OR: [
              { name: { contains: query } },
              { brand: { contains: query } },
              { model: { contains: query } },
              { category: { contains: query } },
              { sku: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    ...(skip != null ? { skip } : {}),
    ...(take != null ? { take } : {}),
  });
}

export function getItem(id: string) {
  return db.item.findUnique({ where: { id } });
}

export async function saveItem(id: string | null, input: ItemInput, actorId: string) {
  return db.$transaction(async (tx) => {
    await assertSkuFree(tx, input.sku, id);
    if (!id) {
      const created = await tx.item.create({ data: input });
      await writeAudit(tx, { userId: actorId, entityType: "Item", entityId: created.id, action: "create", after: created });
      return created;
    }
    const before = await tx.item.findUniqueOrThrow({ where: { id } });
    const after = await tx.item.update({ where: { id }, data: input });
    await writeAudit(tx, { userId: actorId, entityType: "Item", entityId: id, action: "update", before, after });
    return after;
  });
}

/** Items are never deleted: inactive hides them from the picker (Step 3). History stays. */
export async function setItemActive(id: string, active: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.item.findUniqueOrThrow({ where: { id } });
    const after = await tx.item.update({ where: { id }, data: { active } });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "Item",
      entityId: id,
      action: active ? "restore" : "archive",
      before,
      after,
    });
    return after;
  });
}
