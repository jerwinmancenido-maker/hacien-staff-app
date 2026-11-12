/** Shared rules for the header top search → /search page. */

export const TOP_SEARCH_MIN_Q = 2;
export const TOP_SEARCH_GROUP_LIMIT = 5;

/** Coerce Next.js searchParams `q` (string | string[]) to one trimmed query, or null. */
export function normalizeTopSearchQuery(raw: string | string[] | null | undefined): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return null;
  const q = first.trim();
  return q.length >= TOP_SEARCH_MIN_Q ? q : null;
}

export function topSearchListHref(path: string, q: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ q, ...extra });
  return `${path}?${params.toString()}`;
}

/** Prefer the Received tab when any shown hit is history-only (not awaiting delivery). */
export function receivingSeeAllHref(q: string, openIds: ReadonlySet<string>, shownIds: readonly string[]): string {
  const needsHistory = shownIds.some((id) => !openIds.has(id));
  return needsHistory ? topSearchListHref("/receiving", q, { history: "1" }) : topSearchListHref("/receiving", q);
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
