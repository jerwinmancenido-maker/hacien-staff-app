/** Shared rules for the header top search → /search page. */

export const TOP_SEARCH_MIN_Q = 2;
export const TOP_SEARCH_GROUP_LIMIT = 5;

/** Trimmed query if long enough to search; otherwise null (do nothing). */
export function normalizeTopSearchQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? "").trim();
  return q.length >= TOP_SEARCH_MIN_Q ? q : null;
}

export function topSearchListHref(path: string, q: string): string {
  const params = new URLSearchParams({ q });
  return `${path}?${params.toString()}`;
}

export type TopSearchHit = {
  id: string;
  href: string;
  primary: string;
  secondary: string;
  status: string;
};

export function takeTopSearchHits<T>(
  rows: T[],
  map: (row: T) => TopSearchHit,
  limit = TOP_SEARCH_GROUP_LIMIT,
): TopSearchHit[] {
  return rows.slice(0, limit).map(map);
}

/** Merge receiving open + history lists by id, keeping first occurrence. */
export function mergeReceivingSearchRows<T extends { id: string }>(open: T[], history: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of [...open, ...history]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
