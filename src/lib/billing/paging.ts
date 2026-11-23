/** Pure paging math for the billings list (finding 1023). */

export const BILLING_PAGE_SIZE_DEFAULT = 100;
export const BILLING_PAGE_SIZE_MAX = 500;

export type BillingPageWindow = {
  page: number;
  pageSize: number;
  totalPages: number;
  skip: number;
  take: number;
};

/**
 * Clamp a requested page/pageSize against a filtered total. pageSize
 * defaults to 100 and clamps to 1-500; page clamps into 1..totalPages
 * (an empty list still has exactly one page).
 */
export function billingPageWindow(total: number, page?: number, pageSize?: number): BillingPageWindow {
  const size =
    typeof pageSize === "number" && Number.isFinite(pageSize)
      ? Math.min(BILLING_PAGE_SIZE_MAX, Math.max(1, Math.trunc(pageSize)))
      : BILLING_PAGE_SIZE_DEFAULT;
  const count = typeof total === "number" && Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const totalPages = Math.max(1, Math.ceil(count / size));
  const wanted = typeof page === "number" && Number.isFinite(page) ? Math.trunc(page) : 1;
  const current = Math.min(totalPages, Math.max(1, wanted));
  return { page: current, pageSize: size, totalPages, skip: (current - 1) * size, take: size };
}
