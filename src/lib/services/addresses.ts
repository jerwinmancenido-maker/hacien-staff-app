// Structured addresses under a customer or supplier. Many per owner, one
// default per kind (billing, delivery, …). Archived, never deleted. Every
// change writes an audit row in the same transaction.

import type { Address, AddressKind } from "@prisma/client";
import { db, type Db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { formatAddress } from "../addresses/format";
import { defaultsPlan, ownerError, supplierAddressError } from "../addresses/rules";
import type { AddressInput } from "../validation/addresses";
import { CompanyRuleError } from "./companies";
import type { ContactOwner as Owner } from "./contacts";

export type AddressOwner = Owner;

const ownerWhere = (o: AddressOwner) => (o.kind === "customer" ? { customerId: o.id } : { supplierId: o.id });

export function addressOwnerOf(a: Pick<Address, "customerId" | "supplierId">): AddressOwner {
  const err = ownerError(a);
  if (err) throw new CompanyRuleError(err);
  return a.customerId ? { kind: "customer", id: a.customerId } : { kind: "supplier", id: a.supplierId! };
}

async function lockOwner(tx: Tx, o: AddressOwner) {
  const rows =
    o.kind === "customer"
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`Customer\` WHERE id = ${o.id} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`Supplier\` WHERE id = ${o.id} FOR UPDATE`;
  if (rows.length === 0) throw new CompanyRuleError(`That ${o.kind} doesn't exist.`);
}

/** Active addresses first (defaults, then by kind), archived last. */
export function listAddresses(owner: AddressOwner, opts: { includeArchived?: boolean } = {}, client: Db | Tx = db) {
  return client.address.findMany({
    where: { ...ownerWhere(owner), ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: "asc" }, { isDefault: "desc" }, { kind: "asc" }, { createdAt: "asc" }],
  });
}

/** Re-apply the one-default-per-kind rule and the supplier rule; audit flag changes. */
async function settle(tx: Tx, owner: AddressOwner, actorId: string, preferId?: string | null) {
  const active = await tx.address.findMany({ where: { ...ownerWhere(owner), archivedAt: null } });
  if (owner.kind === "supplier") {
    const err = supplierAddressError(active);
    if (err) throw new CompanyRuleError(err, "kind");
  }
  const plan = defaultsPlan(active, preferId);
  for (const [ids, value] of [
    [plan.unset, false],
    [plan.set, true],
  ] as const) {
    for (const id of ids) {
      const before = active.find((a) => a.id === id)!;
      const after = await tx.address.update({ where: { id }, data: { isDefault: value } });
      await writeAudit(tx, { userId: actorId, entityType: "Address", entityId: id, action: "update", before, after });
    }
  }
}

const auditable = (a: Address) => ({ ...a, oneLine: formatAddress(a) });

export async function saveAddress(id: string | null, owner: AddressOwner, input: AddressInput, actorId: string) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, owner);
    const { isDefault, ...fields } = input;
    if (!id) {
      const created = await tx.address.create({ data: { ...fields, ...ownerWhere(owner), isDefault: false } });
      await writeAudit(tx, { userId: actorId, entityType: "Address", entityId: created.id, action: "create", after: auditable(created) });
      await settle(tx, owner, actorId, isDefault ? created.id : null);
      return tx.address.findUniqueOrThrow({ where: { id: created.id } });
    }
    const before = await tx.address.findUniqueOrThrow({ where: { id } });
    const current = addressOwnerOf(before);
    if (current.kind !== owner.kind || current.id !== owner.id) throw new CompanyRuleError("This address belongs to someone else.");
    if (before.archivedAt) throw new CompanyRuleError("Restore this address before editing it.");
    // Saving the fields counts as the review of an address copied from the old text.
    // Moving to another kind drops the old kind's default flag (settle() picks a new one there).
    const kindChanged = fields.kind !== before.kind;
    const after = await tx.address.update({ where: { id }, data: { ...fields, needsReview: false, ...(kindChanged ? { isDefault: false } : {}) } });
    await writeAudit(tx, { userId: actorId, entityType: "Address", entityId: id, action: "update", before: auditable(before), after: auditable(after) });
    await settle(tx, owner, actorId, isDefault ? id : null);
    return tx.address.findUniqueOrThrow({ where: { id } });
  });
}

export async function setAddressArchived(id: string, archived: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const first = await tx.address.findUniqueOrThrow({ where: { id } });
    const owner = addressOwnerOf(first);
    await lockOwner(tx, owner);
    const before = await tx.address.findUniqueOrThrow({ where: { id } });
    if (!!before.archivedAt === archived) return before;
    const after = await tx.address.update({
      where: { id },
      data: archived ? { archivedAt: new Date(), isDefault: false } : { archivedAt: null },
    });
    await writeAudit(tx, { userId: actorId, entityType: "Address", entityId: id, action: archived ? "archive" : "restore", before, after });
    await settle(tx, owner, actorId);
    return after;
  });
}

export async function makeDefaultAddress(id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.address.findUniqueOrThrow({ where: { id } });
    if (before.archivedAt) throw new CompanyRuleError("Restore this address first.");
    const owner = addressOwnerOf(before);
    await lockOwner(tx, owner);
    await settle(tx, owner, actorId, id);
    return tx.address.findUniqueOrThrow({ where: { id } });
  });
}

/** The active default of a kind, if any. */
export function defaultAddress(owner: AddressOwner, kind: AddressKind, client: Db | Tx = db) {
  return client.address.findFirst({ where: { ...ownerWhere(owner), kind, archivedAt: null, isDefault: true } });
}

/**
 * Text for a customer block on print / quotes: the default billing address,
 * else the default office address, else the old free-text address.
 */
export async function customerBlockAddress(customer: { id: string; address: string | null }, client: Db | Tx = db): Promise<string | null> {
  const owner: AddressOwner = { kind: "customer", id: customer.id };
  const a = (await defaultAddress(owner, "BILLING", client)) ?? (await defaultAddress(owner, "OFFICE", client));
  return a ? formatAddress(a, { multiline: true }) : (customer.address?.trim() || null);
}

/** Suggested SO delivery address: default delivery, else the billing block. */
export async function suggestedDeliveryAddress(customer: { id: string; address: string | null }, client: Db | Tx = db): Promise<string | null> {
  const a = await defaultAddress({ kind: "customer", id: customer.id }, "DELIVERY", client);
  return a ? formatAddress(a, { multiline: true }) : customerBlockAddress(customer, client);
}
