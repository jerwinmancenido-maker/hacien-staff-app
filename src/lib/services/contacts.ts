// Contacts under a customer or supplier. Exactly one main contact per company
// while it has active contacts. Never deleted.

import type { Contact } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { deactivateContactError, makeMainError, makeMainPlan, newContactIsMain } from "../contacts";
import type { ContactInput } from "../validation/companies";
import { CompanyRuleError } from "./companies";

export type ContactOwner = { kind: "customer" | "supplier"; id: string };

export function ownerOf(c: Pick<Contact, "customerId" | "supplierId">): ContactOwner {
  return c.customerId ? { kind: "customer", id: c.customerId } : { kind: "supplier", id: c.supplierId! };
}

const ownerWhere = (o: ContactOwner) => (o.kind === "customer" ? { customerId: o.id } : { supplierId: o.id });

/** Lock the owning company row so main-contact changes can't race. */
async function lockOwner(tx: Tx, o: ContactOwner) {
  if (o.kind === "customer") await tx.$queryRaw`SELECT id FROM \`Customer\` WHERE id = ${o.id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM \`Supplier\` WHERE id = ${o.id} FOR UPDATE`;
}

async function unsetOtherMains(tx: Tx, o: ContactOwner, newMainId: string, actorId: string) {
  const siblings = await tx.contact.findMany({ where: ownerWhere(o) });
  const plan = makeMainPlan(siblings, newMainId);
  for (const id of plan.unset) {
    const before = siblings.find((s) => s.id === id)!;
    const after = await tx.contact.update({ where: { id }, data: { isMain: false } });
    await writeAudit(tx, { userId: actorId, entityType: "Contact", entityId: id, action: "update", before, after });
  }
}

export async function addContact(owner: ContactOwner, input: ContactInput, actorId: string) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, owner);
    const existing = await tx.contact.findMany({ where: ownerWhere(owner) });
    const isMain = newContactIsMain(existing, input.isMain);
    const created = await tx.contact.create({ data: { ...input, isMain, ...ownerWhere(owner) } });
    if (isMain) await unsetOtherMains(tx, owner, created.id, actorId);
    await writeAudit(tx, { userId: actorId, entityType: "Contact", entityId: created.id, action: "create", after: created });
    return created;
  });
}

export async function updateContact(id: string, input: ContactInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.contact.findUniqueOrThrow({ where: { id } });
    const owner = ownerOf(before);
    await lockOwner(tx, owner);
    // Main can only be moved to another contact ("Make main"), not switched off here.
    const becomeMain = input.isMain && !before.isMain;
    if (becomeMain) {
      const err = makeMainError(before);
      if (err) throw new CompanyRuleError(err);
      await unsetOtherMains(tx, owner, id, actorId);
    }
    const after = await tx.contact.update({ where: { id }, data: { ...input, isMain: before.isMain || becomeMain } });
    await writeAudit(tx, { userId: actorId, entityType: "Contact", entityId: id, action: "update", before, after });
    return after;
  });
}

export async function makeMainContact(id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.contact.findUniqueOrThrow({ where: { id } });
    const err = makeMainError(before);
    if (err) throw new CompanyRuleError(err);
    if (before.isMain) return before;
    const owner = ownerOf(before);
    await lockOwner(tx, owner);
    await unsetOtherMains(tx, owner, id, actorId);
    const after = await tx.contact.update({ where: { id }, data: { isMain: true } });
    await writeAudit(tx, { userId: actorId, entityType: "Contact", entityId: id, action: "update", before, after });
    return after;
  });
}

export async function setContactActive(id: string, active: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.contact.findUniqueOrThrow({ where: { id } });
    if (before.active === active) return before;
    const owner = ownerOf(before);
    await lockOwner(tx, owner);
    if (!active) {
      const err = deactivateContactError(before);
      if (err) throw new CompanyRuleError(err);
    }
    let isMain = before.isMain;
    if (active) {
      // Turning a contact back on: it becomes main if the company has no active main.
      const siblings = await tx.contact.findMany({ where: ownerWhere(owner) });
      isMain = newContactIsMain(siblings, false);
    }
    const after = await tx.contact.update({
      where: { id },
      data: { active, archivedAt: active ? null : new Date(), isMain },
    });
    await writeAudit(tx, { userId: actorId, entityType: "Contact", entityId: id, action: active ? "restore" : "archive", before, after });
    return after;
  });
}

/** Owner company name (null if it doesn't exist). */
export async function ownerName(o: ContactOwner): Promise<string | null> {
  const row =
    o.kind === "customer"
      ? await db.customer.findUnique({ where: { id: o.id }, select: { name: true } })
      : await db.supplier.findUnique({ where: { id: o.id }, select: { name: true } });
  return row?.name ?? null;
}
