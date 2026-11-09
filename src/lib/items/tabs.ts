// Shared tab keys for the item detail pages (/items/[id] and
// /items/history). Tabs keep the page from growing with the item's
// history: only the active tab's table renders (Jerwin, 2026-11-08).

export const ITEM_TABS = ["details", "prices", "suppliers", "used"] as const;

export type ItemTab = (typeof ITEM_TABS)[number];

export function resolveItemTab(raw: string | undefined): ItemTab {
  return ITEM_TABS.includes(raw as ItemTab) ? (raw as ItemTab) : "details";
}
