// Server-side data for the quote / SO editor. Suppliers are only loaded for
// users who can see costs (the editor shows no cost fields without them).

import type { Address } from "@prisma/client";
import { db } from "@/lib/db";
import { canSeeCosts, type PermissionUser } from "@/lib/permissions";
import { listWithholdingRates, toSnapshot } from "@/lib/services/withholding";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import { allowGovVatOption, parseWithholdingPick, WITHHOLDING_DEFAULT_CODES } from "@/lib/quotes/withholding-defaults";
import { formatAddress } from "@/lib/addresses/format";
import { ADDRESS_KIND_LABELS, type AddressKindValue } from "@/lib/validation/addresses";
import type { EditorAddressOption, EditorCustomer } from "@/components/docs/DocumentEditor";

/** Shape one saved address for the quote editor's delivery picker. The
 * label matches the Convert dialog's options on the quote record page. */
export function toEditorAddressOption(a: Address): EditorAddressOption {
  return {
    id: a.id,
    kind: a.kind,
    label: `${ADDRESS_KIND_LABELS[a.kind as AddressKindValue]}${a.label ? ` · ${a.label}` : ""}${a.isDefault ? " (default)" : ""}: ${formatAddress(a)}`,
    isDefault: a.isDefault,
    text: formatAddress(a, { multiline: true }),
    oneLine: formatAddress(a),
  };
}

export async function editorCustomers(where: { id?: string } = {}): Promise<EditorCustomer[]> {
  const customers = await db.customer.findMany({
    where: where.id ? { id: where.id } : { active: true },
    include: {
      contacts: { where: { active: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] },
      addresses: {
        where: { archivedAt: null },
        orderBy: [{ isDefault: "desc" }, { kind: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
  return customers.map((c) => {
    // Delivery options first, like the Convert dialog; the rest keep the
    // defaults-first order from the query.
    const addresses = [...c.addresses]
      .sort((a, b) => Number(b.kind === "DELIVERY") - Number(a.kind === "DELIVERY"))
      .map(toEditorAddressOption);
    const defaultDelivery = c.addresses.find((a) => a.kind === "DELIVERY" && a.isDefault);
    // Same rule as customerBlockAddress: default BILLING, else default
    // OFFICE, else the legacy free-text address.
    const billing = c.addresses.find((a) => a.kind === "BILLING" && a.isDefault) ?? c.addresses.find((a) => a.kind === "OFFICE" && a.isDefault);
    return {
      id: c.id,
      name: c.name,
      address: c.address,
      defaultTerms: c.defaultTerms,
      withholdingType: c.withholdingType,
      defaultWithholding: parseWithholdingPick(c.defaultWithholding),
      creditLimit: c.creditLimit === null ? null : String(c.creditLimit),
      contacts: c.contacts.map((k) => ({ id: k.id, name: k.name, isMain: k.isMain })),
      addresses,
      defaultDeliveryId: defaultDelivery?.id ?? null,
      billingText: billing ? formatAddress(billing, { multiline: true }) : (c.address?.trim() || null),
    };
  });
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
