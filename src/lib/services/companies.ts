// Customers and suppliers: create, update, mark inactive / active. Never deleted.

import { Prisma, type WithholdingType, type SupplierTaxType } from "@prisma/client";
import { db, isUniqueViolation } from "../db";
import { writeAudit } from "../audit";
import type { CustomerInput, SupplierInput } from "../validation/companies";

export class CompanyRuleError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerFilter = { q?: string; withholding?: WithholdingType; showInactive?: boolean; onlyIds?: string[] };

/** The default billing / office address, for list rows. */
const mainAddress = {
  addresses: { where: { archivedAt: null, isDefault: true, kind: { in: ["BILLING", "OFFICE"] } }, orderBy: { kind: "asc" }, take: 1 },
} satisfies Prisma.CustomerInclude;

export function listCustomers(f: CustomerFilter) {
  const q = f.q?.trim();
  return db.customer.findMany({
    where: {
      ...(f.onlyIds ? { id: { in: f.onlyIds } } : {}),
      ...(f.showInactive ? {} : { active: true }),
      ...(f.withholding ? { withholdingType: f.withholding } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { tin: { contains: q.replace(/\s+/g, "") } }] } : {}),
    },
    include: mainAddress,
    orderBy: { name: "asc" },
  });
}

export function getCustomer(id: string) {
  return db.customer.findUnique({
    where: { id },
    include: { contacts: { orderBy: [{ active: "desc" }, { isMain: "desc" }, { name: "asc" }] } },
  });
}

type TinOwnerLookup = (args: { where: Prisma.CustomerWhereInput & Prisma.SupplierWhereInput }) => Promise<{ name: string } | null>;

/** TINs are unique among customers and, separately, among suppliers. Throws a friendly error naming the owner. */
async function assertTinFree(find: TinOwnerLookup, tin: string | null, exceptId: string | null) {
  if (!tin) return;
  const other = await find({ where: { tin, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
  if (other) throw new CompanyRuleError(`This TIN belongs to ${other.name}.`, "tin");
}

const customerTinOwner: TinOwnerLookup = (args) => db.customer.findFirst(args);
const supplierTinOwner: TinOwnerLookup = (args) => db.supplier.findFirst(args);

/** Prisma JSON columns reject plain `null`; use DbNull for "not set". */
function defaultWithholdingData(
  pick: CustomerInput["defaultWithholding"],
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (pick === undefined) return undefined;
  if (pick === null) return Prisma.DbNull;
  return pick;
}

export async function saveCustomer(id: string | null, input: CustomerInput, actorId: string) {
  await assertTinFree(customerTinOwner, input.tin, id);
  const data = {
    name: input.name,
    tin: input.tin,
    withholdingType: input.withholdingType,
    defaultWithholding: defaultWithholdingData(input.defaultWithholding),
    defaultTerms: input.defaultTerms,
    notes: input.notes,
  };
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        const created = await tx.customer.create({ data });
        await writeAudit(tx, { userId: actorId, entityType: "Customer", entityId: created.id, action: "create", after: created });
        return created;
      }
      const before = await tx.customer.findUniqueOrThrow({ where: { id } });
      const after = await tx.customer.update({ where: { id }, data });
      await writeAudit(tx, { userId: actorId, entityType: "Customer", entityId: id, action: "update", before, after });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      await assertTinFree(customerTinOwner, input.tin, id); // re-throws with the owner's name
    }
    throw e;
  }
}

export async function setCustomerActive(id: string, active: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.customer.findUniqueOrThrow({ where: { id } });
    if (before.active === active) return before;
    const after = await tx.customer.update({ where: { id }, data: { active, archivedAt: active ? null : new Date() } });
    await writeAudit(tx, { userId: actorId, entityType: "Customer", entityId: id, action: active ? "restore" : "archive", before, after });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export type SupplierFilter = { q?: string; taxType?: SupplierTaxType; showInactive?: boolean; onlyIds?: string[] };

export function listSuppliers(f: SupplierFilter) {
  const q = f.q?.trim();
  return db.supplier.findMany({
    where: {
      ...(f.onlyIds ? { id: { in: f.onlyIds } } : {}),
      ...(f.showInactive ? {} : { active: true }),
      ...(f.taxType ? { taxType: f.taxType } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { tin: { contains: q.replace(/\s+/g, "") } }] } : {}),
    },
    include: mainAddress,
    orderBy: { name: "asc" },
  });
}

export function getSupplier(id: string) {
  return db.supplier.findUnique({
    where: { id },
    include: { contacts: { orderBy: [{ active: "desc" }, { isMain: "desc" }, { name: "asc" }] } },
  });
}

export async function saveSupplier(id: string | null, input: SupplierInput, actorId: string) {
  await assertTinFree(supplierTinOwner, input.tin, id);
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        const created = await tx.supplier.create({ data: input });
        await writeAudit(tx, { userId: actorId, entityType: "Supplier", entityId: created.id, action: "create", after: created });
        return created;
      }
      const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
      const after = await tx.supplier.update({ where: { id }, data: input });
      await writeAudit(tx, { userId: actorId, entityType: "Supplier", entityId: id, action: "update", before, after });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      await assertTinFree(supplierTinOwner, input.tin, id); // re-throws with the owner's name
    }
    throw e;
  }
}

export async function setSupplierActive(id: string, active: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
    if (before.active === active) return before;
    const after = await tx.supplier.update({ where: { id }, data: { active, archivedAt: active ? null : new Date() } });
    await writeAudit(tx, { userId: actorId, entityType: "Supplier", entityId: id, action: active ? "restore" : "archive", before, after });
    return after;
  });
}
