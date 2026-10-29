// Customers and suppliers: create, update, mark inactive / active. Never deleted.

import { Prisma, type WithholdingType, type SupplierTaxType } from "@prisma/client";
import { db } from "../db";
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

export type CustomerFilter = { q?: string; withholding?: WithholdingType; showInactive?: boolean };

export function listCustomers(f: CustomerFilter) {
  const q = f.q?.trim();
  return db.customer.findMany({
    where: {
      ...(f.showInactive ? {} : { active: true }),
      ...(f.withholding ? { withholdingType: f.withholding } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { tin: { contains: q.replace(/\s+/g, "") } }] } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export function getCustomer(id: string) {
  return db.customer.findUnique({
    where: { id },
    include: { contacts: { orderBy: [{ active: "desc" }, { isMain: "desc" }, { name: "asc" }] } },
  });
}

async function assertTinFree(tin: string | null, exceptId: string | null) {
  if (!tin) return;
  const other = await db.customer.findFirst({ where: { tin, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
  if (other) throw new CompanyRuleError(`This TIN belongs to ${other.name}.`, "tin");
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function saveCustomer(id: string | null, input: CustomerInput, actorId: string) {
  await assertTinFree(input.tin, id);
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        const created = await tx.customer.create({ data: input });
        await writeAudit(tx, { userId: actorId, entityType: "Customer", entityId: created.id, action: "create", after: created });
        return created;
      }
      const before = await tx.customer.findUniqueOrThrow({ where: { id } });
      const after = await tx.customer.update({ where: { id }, data: input });
      await writeAudit(tx, { userId: actorId, entityType: "Customer", entityId: id, action: "update", before, after });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      await assertTinFree(input.tin, id); // re-throws with the owner's name
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

export type SupplierFilter = { q?: string; taxType?: SupplierTaxType; showInactive?: boolean };

export function listSuppliers(f: SupplierFilter) {
  const q = f.q?.trim();
  return db.supplier.findMany({
    where: {
      ...(f.showInactive ? {} : { active: true }),
      ...(f.taxType ? { taxType: f.taxType } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { tin: { contains: q.replace(/\s+/g, "") } }] } : {}),
    },
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
  return db.$transaction(async (tx) => {
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
