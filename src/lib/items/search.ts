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

const MAX_RESULTS = 8;

/**
 * Catalog Step 3: the quote editor picker. Active items only, matching the
 * typed text against name / brand / model / SKU / category. Under 2 chars =
 * no search. An item whose SKU equals the query exactly always ranks first
 * (that is what a barcode scanner sends); the rest are name-ordered.
 */
export async function searchCatalogItems(query: string): Promise<CatalogSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const select = {
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
  } as const;
  const exactSku = await db.item.findMany({
    where: { active: true, sku: { equals: q } },
    orderBy: [{ name: "asc" }],
    take: MAX_RESULTS,
    select,
  });
  const rest = await db.item.findMany({
    where: {
      active: true,
      ...(exactSku.length ? { id: { notIn: exactSku.map((r) => r.id) } } : {}),
      OR: [
        { name: { contains: q } },
        { brand: { contains: q } },
        { model: { contains: q } },
        { sku: { contains: q } },
        { category: { contains: q } },
      ],
    },
    orderBy: [{ name: "asc" }],
    take: MAX_RESULTS - exactSku.length,
    select,
  });
  return [...exactSku, ...rest].map((r) => ({
    ...r,
    defaultUnitPrice: r.defaultUnitPrice != null ? String(r.defaultUnitPrice) : null,
  }));
}
