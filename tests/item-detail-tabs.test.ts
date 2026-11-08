import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ITEM_TABS, resolveItemTab } from "@/lib/items/tabs";

// Item detail tabs (Jerwin, 2026-11-08): the item page's stacked tables
// (price history, supplier comparison, where used) move to their own tabs
// so the page stops growing with the item's history. Same ?tab= pattern
// as the customer / supplier pages.
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const itemPage = read("src/app/(app)/items/[id]/page.tsx");
const historyPage = read("src/app/(app)/items/history/page.tsx");
const detail = read("src/components/ItemHistoryDetail.tsx");

describe("item tabs resolver", () => {
  it("knows the four tabs and defaults to details", () => {
    expect(ITEM_TABS).toEqual(["details", "prices", "suppliers", "used"]);
    expect(resolveItemTab("prices")).toBe("prices");
    expect(resolveItemTab("suppliers")).toBe("suppliers");
    expect(resolveItemTab("used")).toBe("used");
    expect(resolveItemTab("details")).toBe("details");
    expect(resolveItemTab("bogus")).toBe("details");
    expect(resolveItemTab(undefined)).toBe("details");
  });
});

describe("item detail pages render tabs", () => {
  it("both pages use PillTabs with the shared resolver and counts", () => {
    for (const page of [itemPage, historyPage]) {
      expect(page).toContain("PillTabs");
      expect(page).toContain("resolveItemTab");
      expect(page).toContain("itemTabCounts");
      expect(page).toContain('label: "Price history"');
      expect(page).toContain('label: "Where used"');
      // Suppliers tab is gated on the costs role on both pages.
      expect(page).toContain('if (tab === "suppliers" && !showCosts) tab = "details";');
      expect(page).toContain("section={tab}");
    }
  });

  it("the catalog page keeps the edit form on the Details tab only", () => {
    expect(itemPage).toContain('tab === "details" &&');
    expect(itemPage).toContain("<ItemForm");
    expect(itemPage).toContain("?tab=prices");
    expect(itemPage).toContain("?tab=used");
  });

  it("the history page carries the item through its tab links", () => {
    expect(historyPage).toContain("encodeURIComponent(description)");
    expect(historyPage).toContain("&tab=prices");
  });
});

describe("ItemHistoryDetail renders one section per tab", () => {
  it("switches on the section and keeps every section's heading", () => {
    expect(detail).toContain('section === "prices"');
    expect(detail).toContain('section === "suppliers"');
    expect(detail).toContain('section === "used"');
    expect(detail).toContain("<h2>Last price and cost</h2>");
    expect(detail).toContain("<h2>Price history</h2>");
    expect(detail).toContain("<h2>Supplier comparison</h2>");
    expect(detail).toContain("<h2>Where used</h2>");
    // The suppliers section still refuses non-costs viewers on its own.
    expect(detail).toContain("if (!showCosts) return null;");
    // Counts come from the same data functions the sections use.
    expect(detail).toContain("export async function itemTabCounts");
  });
});
