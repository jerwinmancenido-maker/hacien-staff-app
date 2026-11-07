import { db } from "@/lib/db";

export type CatalogSearchResult = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  sku: string | null;
  unit: string;
  kind: "GOODS" | "SERVICES";
  details: string | null;
  defaultUnitPrice: string | null;
};

/**
 * Catalog Step 3: the quote editor picker. Active items only, matching the
 * typed text against name / brand / model / SKU. Under 2 chars = no search.
 */
export async function searchCatalogItems(query: string): Promise<CatalogSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db.item.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q } },
        { brand: { contains: q } },
        { model: { contains: q } },
        { sku: { contains: q } },
      ],
    },
    orderBy: [{ name: "asc" }],
    take: 8,
    select: {
      id: true,
      name: true,
      brand: true,
      model: true,
      category: true,
      sku: true,
      unit: true,
      kind: true,
      details: true,
      defaultUnitPrice: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    defaultUnitPrice: r.defaultUnitPrice != null ? String(r.defaultUnitPrice) : null,
  }));
}
