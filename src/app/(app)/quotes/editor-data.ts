// Server-side data for the quote / SO editor. Suppliers are only loaded for
// users who can see costs (the editor shows no cost fields without them).

import { db } from "@/lib/db";
import { canSeeCosts, type PermissionUser } from "@/lib/permissions";
import { listWithholdingRates, toSnapshot } from "@/lib/services/withholding";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import { allowGovVatOption, parseWithholdingPick, WITHHOLDING_DEFAULT_CODES } from "@/lib/quotes/withholding-defaults";
import type { EditorCustomer } from "@/components/docs/DocumentEditor";

export async function editorCustomers(where: { id?: string } = {}): Promise<EditorCustomer[]> {
  const customers = await db.customer.findMany({
    where: where.id ? { id: where.id } : { active: true },
    include: { contacts: { where: { active: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] } },
    orderBy: { name: "asc" },
  });
  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    address: c.address,
    defaultTerms: c.defaultTerms,
    withholdingType: c.withholdingType,
    defaultWithholding: parseWithholdingPick(c.defaultWithholding),
    creditLimit: c.creditLimit === null ? null : String(c.creditLimit),
    contacts: c.contacts.map((k) => ({ id: k.id, name: k.name, isMain: k.isMain })),
  }));
}

/**
 * Active Settings → Withholding rates for the pick UI.
 * Document summary rows (LINE_*) such as a combined "Goods 4%" are never pickable —
 * staff combine Goods 1% + Government 3% instead. Hides Gov VAT when non-VAT.
 */
export async function editorRates(existing: WithholdingSnapshot[] = []): Promise<WithholdingSnapshot[]> {
  const active = (await listWithholdingRates(db, { activeOnly: true })).map(toSnapshot);
  // Keep inactive Settings rates still referenced on the document; never LINE_* synthetics.
  const keptSettings = existing.filter(
    (e) => Boolean(e.code) && !String(e.code).startsWith("LINE_") && !active.some((a) => a.code === e.code),
  );
  const merged = [...keptSettings, ...active];
  if (allowGovVatOption()) return merged;
  return merged.filter((r) => r.code !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5);
}

export async function editorSuppliers(user: PermissionUser) {
  if (!canSeeCosts(user)) return null;
  return db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export type EditorStaffUser = {
  id: string;
  name: string;
  position: string | null;
  hasSignature: boolean;
};

/**
 * Preparer picker: every active staff user, for the quote "Prepared by" choice.
 * includeId keeps a stored preparer listed even after they were turned off,
 * so an old quote can still be saved without changing its preparer.
 */
export async function editorStaffUsers(includeId?: string | null): Promise<EditorStaffUser[]> {
  const users = await db.user.findMany({
    where: { active: true },
    select: { id: true, name: true, position: true, signatureStorageKey: true },
    orderBy: { name: "asc" },
  });
  const list = users.map((u) => ({ id: u.id, name: u.name, position: u.position, hasSignature: u.signatureStorageKey !== null }));
  if (includeId && !list.some((u) => u.id === includeId)) {
    const kept = await db.user.findUnique({
      where: { id: includeId },
      select: { id: true, name: true, position: true, signatureStorageKey: true },
    });
    if (kept) list.push({ id: kept.id, name: kept.name, position: kept.position, hasSignature: kept.signatureStorageKey !== null });
  }
  return list;
}
