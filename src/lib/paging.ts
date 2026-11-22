// Shared paging math for the big list pages (quotes, sales orders, …).
// Pure functions only — no database, no framework — so unit tests can pin
// the slicing/clamping behaviour directly (tests/list-paging.test.ts).

export const DEFAULT_LIST_PAGE_SIZE = 100;

/** One page of a list plus everything a pager needs to render. */
export type ListPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type PagingWindow = {
  page: number;
  pageSize: number;
  totalPages: number;
  skip: number;
  take: number;
};

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/**
 * Resolve a requested page/pageSize against a total row count.
 * - pageSize defaults to DEFAULT_LIST_PAGE_SIZE when missing/invalid.
 * - totalPages is at least 1 (an empty list is "page 1 of 1").
 * - page is clamped into [1, totalPages] — a stale ?page=99 link lands on
 *   the last page instead of an empty screen.
 */
export function pagingWindow(total: number, page?: number, pageSize?: number): PagingWindow {
  const safeTotal = typeof total === "number" && Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const size = positiveInt(pageSize, DEFAULT_LIST_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(safeTotal / size));
  const clampedPage = Math.min(positiveInt(page, 1), totalPages);
  const skip = (clampedPage - 1) * size;
  return { page: clampedPage, pageSize: size, totalPages, skip, take: size };
}
