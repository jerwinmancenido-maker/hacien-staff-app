/**
 * URL params of the Billings / Collections list pages. Both pages share the
 * same param names; Billings adds customerId (a hidden filter threaded from
 * the customer page) and page/pageSize for its pager.
 */
export type BillingListSearch = {
  q?: string;
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
};

/**
 * Param-patch href for the Billings / Collections lists — the same shape as
 * the quotes / sales-orders href(s, patch) helper: the patch merges over the
 * current params, a patch value of undefined clears that param, and a patch
 * that does not name `page` restarts at page 1 (filter changes restart
 * paging; only a patch that names the page keeps one). Every other current
 * param — Billings customerId included — threads through untouched.
 */
export function billingListHref(
  basePath: string,
  s: BillingListSearch,
  patch: Partial<BillingListSearch>,
): string {
  const merged: BillingListSearch = { ...s, ...patch };
  if (!("page" in patch)) delete merged.page;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
