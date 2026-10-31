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
