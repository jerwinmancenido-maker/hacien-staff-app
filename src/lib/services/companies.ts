// Customers and suppliers: create, update, mark inactive / active. Never deleted.

import { Prisma, type WithholdingType, type SupplierTaxType } from "@prisma/client";
import { settleApiWrite } from "../api/context";
import { db, isUniqueViolation } from "../db";
import { writeAudit } from "../audit";
import { extractLast4, isMaskedBankAccountNumber, maskBankAccountNumber, resolveBankAccountNumber } from "../bank-mask";
import { ForbiddenError } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import type { CustomerInput, SupplierInput } from "../validation/companies";
import { listWithholdingRates } from "./withholding";

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

export type CustomerFilter = {
  q?: string;
  /** S-58: false = the search matches names only, never TINs. */
  matchTin?: boolean;
  withholding?: WithholdingType;
  /** Customers whose saved pick is still null (not set). Distinct from type NONE / pick []. */
  withholdingPick?: "NOT_SET";
  showInactive?: boolean;
  onlyIds?: string[];
  /** Page window for /api/v1. The staff UI omits these and loads the filtered list. */
  skip?: number;
  take?: number;
};

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
      // JSON null only — empty [] (explicit none) and picked codes do not match.
      ...(f.withholdingPick === "NOT_SET" ? { defaultWithholding: { equals: Prisma.DbNull } } : {}),
      ...(q
        ? {
            OR:
              f.matchTin === false
                ? [{ name: { contains: q } }]
                : [{ name: { contains: q } }, { tin: { contains: q.replace(/\s+/g, "") } }],
          }
        : {}),
    },
    include: mainAddress,
    orderBy: { name: "asc" },
    ...(f.skip != null ? { skip: f.skip } : {}),
    ...(f.take != null ? { take: f.take } : {}),
  });
}

export function getCustomer(id: string) {
  return db.customer.findUnique({
    where: { id },
    include: { contacts: { orderBy: [{ active: "desc" }, { isMain: "desc" }, { name: "asc" }] } },
  });
}

/**
 * Terms list and withholding codes for a customer save. Shared by the staff
 * form and /api/v1 so both follow the same rules: a blank existing term may
 * stay blank, and a term already on the record stays valid if it leaves Settings.
 */
export async function loadCustomerWriteOptions(id: string | null): Promise<{
  allowedTerms: string[];
  activeCodes: string[];
  termsRequired: boolean;
}> {
  const { settings } = await getSettingsSnapshot();
  const activeCodes = (await listWithholdingRates(undefined, { activeOnly: true })).map((r) => r.code);
  let allowedTerms = [...settings.lists.paymentTerms];
  let termsRequired = true;
  if (id) {
    const existing = await getCustomer(id);
    const current = existing?.defaultTerms?.trim() ?? "";
    if (current && !allowedTerms.includes(current)) allowedTerms = [...allowedTerms, current];
    if (!current) termsRequired = false;
  }
  return { allowedTerms, activeCodes, termsRequired };
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

function withholdingPickEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v == null) return null;
    if (!Array.isArray(v)) return null;
    return [...v].filter((x): x is string => typeof x === "string").sort().join("\0");
  };
  return norm(a) === norm(b);
}

export type CustomerSaveActor = { id: string; isAdmin?: boolean };

export async function saveCustomer(id: string | null, input: CustomerInput, actor: CustomerSaveActor | string) {
  const actorId = typeof actor === "string" ? actor : actor.id;
  // Fail closed: string actor id alone is not Admin (callers must pass isAdmin).
  const isAdmin = typeof actor === "string" ? false : !!actor.isAdmin;
  await assertTinFree(customerTinOwner, input.tin, id);
  const data = {
    name: input.name,
    tin: input.tin,
    withholdingType: input.withholdingType,
    defaultWithholding: defaultWithholdingData(input.defaultWithholding),
    defaultTerms: input.defaultTerms,
    creditLimit: input.creditLimit,
    notes: input.notes,
    isIndividual: input.isIndividual ?? false,
    orderTextUpdates: input.orderTextUpdates ?? true,
  };
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        const created = await tx.customer.create({ data });
        await writeAudit(tx, { userId: actorId, entityType: "Customer", entityId: created.id, action: "create", after: created });
        await settleApiWrite(tx, created);
        return created;
      }
      const before = await tx.customer.findUniqueOrThrow({ where: { id } });
      const typeChanged = before.withholdingType !== input.withholdingType;
      const pickChanged = !withholdingPickEqual(before.defaultWithholding, input.defaultWithholding);
      // S-19: changing an existing customer's withholding is Admin only (fail closed).
      if ((typeChanged || pickChanged) && !isAdmin) {
        throw new CompanyRuleError("Only an Admin can change an existing customer's withholding.", "defaultWithholding");
      }
      const after = await tx.customer.update({ where: { id }, data });
      await writeAudit(tx, { userId: actorId, entityType: "Customer", entityId: id, action: "update", before, after });
      await settleApiWrite(tx, after);
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

/** Duplicate customer: copy created with name + " (copy)", TIN blank, same addresses copied. */
export async function duplicateCustomer(id: string, actor: CustomerSaveActor | string) {
  const actorId = typeof actor === "string" ? actor : actor.id;
  return db.$transaction(async (tx) => {
    const original = await tx.customer.findUniqueOrThrow({
      where: { id },
      include: { addresses: { where: { archivedAt: null } } },
    });
    const suffix = " (copy)";
    // Name is VARCHAR(191). Keep the suffix so a long name still duplicates.
    const copyName = `${original.name.slice(0, 191 - suffix.length)}${suffix}`;
    const created = await tx.customer.create({
      data: {
        name: copyName,
        tin: null,
        withholdingType: original.withholdingType,
        defaultWithholding: original.defaultWithholding ?? Prisma.DbNull,
        defaultTerms: original.defaultTerms,
        isIndividual: original.isIndividual,
        notes: original.notes,
      },
    });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "Customer",
      entityId: created.id,
      action: "create",
      after: { ...created, duplicatedFrom: original.id },
    });

    for (const a of original.addresses) {
      const addr = await tx.address.create({
        data: {
          customerId: created.id,
          kind: a.kind,
          label: a.label,
          street: a.street,
          barangay: a.barangay,
          cityMunicipality: a.cityMunicipality,
          province: a.province,
          zip: a.zip,
          isDefault: a.isDefault,
          needsReview: a.needsReview,
        },
      });
      await writeAudit(tx, {
        userId: actorId,
        entityType: "Address",
        entityId: addr.id,
        action: "create",
        after: addr,
      });
    }

    return tx.customer.findUniqueOrThrow({
      where: { id: created.id },
      include: { addresses: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export type SupplierFilter = { q?: string; matchTin?: boolean; taxType?: SupplierTaxType; showInactive?: boolean; onlyIds?: string[] };

export function listSuppliers(f: SupplierFilter) {
  const q = f.q?.trim();
  return db.supplier.findMany({
    where: {
      ...(f.onlyIds ? { id: { in: f.onlyIds } } : {}),
      ...(f.showInactive ? {} : { active: true }),
      ...(f.taxType ? { taxType: f.taxType } : {}),
      ...(q
        ? {
            OR:
              f.matchTin === false
                ? [{ name: { contains: q } }]
                : [{ name: { contains: q } }, { tin: { contains: q.replace(/\s+/g, "") } }],
          }
        : {}),
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

export type SupplierSaveActor = { id: string; isAdmin?: boolean };

export async function saveSupplier(id: string | null, input: SupplierInput, actor: SupplierSaveActor | string) {
  const actorId = typeof actor === "string" ? actor : actor.id;
  const isAdmin = typeof actor === "string" ? false : !!actor.isAdmin;
  await assertTinFree(supplierTinOwner, input.tin, id);
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        if (!isAdmin && (input.bankAccountName || input.bankAccountNumber || input.bankBranch || input.bankNotes)) {
          throw new CompanyRuleError("Only an Admin can add or edit bank details.", "bankAccountNumber");
        }
        const created = await tx.supplier.create({
          data: { ...input, bankAccountNumber: resolveBankAccountNumber(input.bankAccountNumber, null) },
        });
        const auditAfter = {
          ...created,
          bankAccountNumber: maskBankAccountNumber(created.bankAccountNumber),
        };
        await writeAudit(tx, { userId: actorId, entityType: "Supplier", entityId: created.id, action: "create", after: auditAfter });
        return created;
      }
      const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
      const submittedNumber = input.bankAccountNumber;
      // A blank or masked display means "keep the stored number", not a change.
      const numberChanged =
        submittedNumber != null &&
        !isMaskedBankAccountNumber(submittedNumber) &&
        submittedNumber !== before.bankAccountNumber;
      const bankAltered =
        (input.bankAccountName != null && input.bankAccountName !== before.bankAccountName) ||
        numberChanged ||
        (input.bankBranch != null && input.bankBranch !== before.bankBranch) ||
        (input.bankNotes != null && input.bankNotes !== before.bankNotes);

      if (bankAltered && !isAdmin) {
        throw new CompanyRuleError("Only an Admin can add or edit bank details.", "bankAccountNumber");
      }

      const finalInput: SupplierInput = !isAdmin
        ? {
            ...input,
            bankAccountName: before.bankAccountName,
            bankAccountNumber: before.bankAccountNumber,
            bankBranch: before.bankBranch,
            bankNotes: before.bankNotes,
          }
        : {
            ...input,
            bankAccountNumber: resolveBankAccountNumber(submittedNumber, before.bankAccountNumber),
          };

      const after = await tx.supplier.update({ where: { id }, data: finalInput });
      const auditBefore = {
        ...before,
        bankAccountNumber: maskBankAccountNumber(before.bankAccountNumber),
      };
      const auditAfter = {
        ...after,
        bankAccountNumber: maskBankAccountNumber(after.bankAccountNumber),
      };
      await writeAudit(tx, { userId: actorId, entityType: "Supplier", entityId: id, action: "update", before: auditBefore, after: auditAfter });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      await assertTinFree(supplierTinOwner, input.tin, id); // re-throws with the owner's name
    }
    throw e;
  }
}

/**
 * Admin explicit action: returns the full number and writes an audit log entry
 * (who, when, supplier, "viewed bank number", last 4 only). NEVER logs the full number.
 */
export async function revealSupplierBankAccount(
  supplierId: string,
  actor: { id: string; isAdmin?: boolean; active?: boolean },
): Promise<string> {
  if (!actor || actor.active === false || !actor.isAdmin) {
    throw new ForbiddenError();
  }
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    throw new CompanyRuleError("Supplier not found.");
  }
  const last4 = extractLast4(supplier.bankAccountNumber);
  const masked = maskBankAccountNumber(supplier.bankAccountNumber);
  await writeAudit(db, {
    userId: actor.id,
    entityType: "Supplier",
    entityId: supplier.id,
    action: "download",
    after: {
      action: "viewed bank number",
      detail: "viewed bank number",
      last4,
      bankAccountNumber: masked,
    },
    diff: false,
  });
  return supplier.bankAccountNumber ?? "";
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
