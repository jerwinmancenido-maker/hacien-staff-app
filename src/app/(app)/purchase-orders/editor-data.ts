// Supplier list for the PO editor (cost users only): active suppliers with their
// active contacts and the formatted default office / billing address.

import { db } from "@/lib/db";
import { formatAddress } from "@/lib/addresses/format";
import type { PoEditorSupplier } from "@/components/purchasing/PoEditor";

export async function poEditorSuppliers(includeId?: string): Promise<PoEditorSupplier[]> {
  const rows = await db.supplier.findMany({
    where: { OR: [{ active: true }, ...(includeId ? [{ id: includeId }] : [])] },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      defaultTerms: true,
      address: true,
      contacts: { where: { active: true }, select: { id: true, name: true, isMain: true }, orderBy: { name: "asc" } },
      addresses: { where: { archivedAt: null, isDefault: true, kind: { in: ["OFFICE", "BILLING"] } } },
    },
  });
  return rows.map((s) => {
    const a = s.addresses.find((x) => x.kind === "OFFICE") ?? s.addresses.find((x) => x.kind === "BILLING");
    return { id: s.id, name: s.name, defaultTerms: s.defaultTerms, contacts: s.contacts, address: a ? formatAddress(a, { multiline: true }) : s.address?.trim() || null };
  });
}
