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
  // S-55: customer-only tab (suppliers simply never link to it).
  "prices",
  // UI tidy-up item 4 (2026-11-07): Recent activity moved off Overview
  // into its own tab, linked last on both company pages.
  "activity",
] as const;

export type CompanyTab = (typeof COMPANY_TABS)[number];

export function resolveCompanyTab(raw: string | undefined): CompanyTab {
  const tab = raw === "history" ? "transactions" : raw;
  return COMPANY_TABS.includes(tab as CompanyTab) ? (tab as CompanyTab) : "overview";
}
