// Shared tab keys for customer and supplier detail pages.
// "?tab=history" kept as an alias of Transactions for old bookmarks.

export const COMPANY_TABS = [
  "overview",
  "details",
  "addresses",
  "contacts",
  "documents",
  "transactions",
  "balances",
] as const;

export type CompanyTab = (typeof COMPANY_TABS)[number];

export function resolveCompanyTab(raw: string | undefined): CompanyTab {
  const tab = raw === "history" ? "transactions" : raw;
  return COMPANY_TABS.includes(tab as CompanyTab) ? (tab as CompanyTab) : "overview";
}
