import type { PermissionUser } from "../permissions";
import { stripCosts } from "../permissions";
import { getItem, listItems } from "../services/items";
import { ApiError } from "./errors";
import { decimalString, parsePageLimit } from "./http";

type ItemShape = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  sku: string | null;
  unit: string;
  kind: string;
  details: string | null;
  defaultUnitPrice: { toFixed: (n: number) => string } | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeItem(row: ItemShape, user: PermissionUser): Record<string, unknown> {
  return stripCosts(
    {
      id: row.id,
      name: row.name,
      brand: row.brand,
      model: row.model,
      category: row.category,
      sku: row.sku,
      unit: row.unit,
      kind: row.kind,
      details: row.details,
      defaultUnitPrice: decimalString(row.defaultUnitPrice),
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    user,
  );
}

export async function listItemsForApi(search: URLSearchParams, user: PermissionUser) {
  const page = parsePageLimit(search);
  if (!page.ok) throw new ApiError(400, "validation", page.error);
  const q = search.get("q")?.trim() ?? "";
  if (q.length > 100) throw new ApiError(400, "validation", "Search must be 100 characters or less.");
  const rows = await listItems({
    q: q || undefined,
    skip: (page.page - 1) * page.limit,
    take: page.limit + 1,
  });
  const hasMore = rows.length > page.limit;
  return {
    items: rows.slice(0, page.limit).map((row) => serializeItem(row, user)),
    page: page.page,
    limit: page.limit,
    hasMore,
  };
}

export async function getItemForApi(id: string, user: PermissionUser) {
  const row = await getItem(id);
  if (!row) throw new ApiError(404, "not_found", "Item not found.");
  return { item: serializeItem(row, user) };
}
