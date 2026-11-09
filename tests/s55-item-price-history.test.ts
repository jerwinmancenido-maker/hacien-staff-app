import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupItemDocuments, groupItemHistory, normalizeDescription } from "@/lib/items/history";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-55 item history grouping", () => {
  it("groups by normalized description and keeps the newest price and cost", () => {
    const rows = groupItemHistory([
      { description: "  Widget  A ", date: "2026-11-03", ref: "QT-2", price: "120.00" },
      { description: "widget a", date: "2026-11-01", ref: "QT-1", price: "100.00" },
      { description: "Widget A", date: "2026-11-02", ref: "PO-1", cost: "80.00" },
      { description: "Cable", date: "2026-11-01", ref: "PO-2", cost: "50.00" },
    ]);
    expect(rows).toHaveLength(2);
    const widget = rows.find((r) => r.key === "widget a")!;
    expect(widget.description).toBe("Widget  A");
    expect(widget.lastPrice).toBe("120.00");
    expect(widget.lastPriceRef).toBe("QT-2");
    expect(widget.lastCost).toBe("80.00");
    expect(widget.lastCostRef).toBe("PO-1");
  });

  it("skips blank descriptions", () => {
    expect(groupItemHistory([{ description: "   ", date: "2026-11-01", ref: "QT-1", price: "1.00" }])).toHaveLength(0);
  });

  it("normalizes case and whitespace", () => {
    expect(normalizeDescription("  Foo   Bar ")).toBe("foo bar");
  });
});

describe("Step 2 item detail grouping", () => {
  it("collapses several lines on one document to one where-used row", () => {
    const docs = groupItemDocuments([
      { description: "Widget A", date: "2026-11-03", ref: "QT-2", price: "120.00", docKind: "quote", docId: "q1" },
      { description: "Widget A", date: "2026-11-03", ref: "QT-2", price: "110.00", docKind: "quote", docId: "q1" },
      { description: "Widget A", date: "2026-11-02", ref: "PO-1", cost: "80.00", docKind: "purchase_order", docId: "p1" },
    ]);
    expect(docs).toEqual([
      { docKind: "quote", docId: "q1", docNumber: "QT-2", date: "2026-11-03" },
      { docKind: "purchase_order", docId: "p1", docNumber: "PO-1", date: "2026-11-02" },
    ]);
  });
});

describe("S-55 surfaces", () => {
  it("items page lists last price and last cost", () => {
    const page = src("src/app/(app)/items/page.tsx");
    expect(page).toContain("Last price");
    expect(page).toContain("Last cost");
    expect(page).toContain("listItemHistory");
  });
  it("catalog rows are clickable to the item detail (DataTable row href)", () => {
    const page = src("src/app/(app)/items/page.tsx");
    expect(page).toContain("DataTable");
    expect(page).toContain("href: `/items/${item.id}`");
  });
  it("history rows link to the history-only detail", () => {
    const page = src("src/app/(app)/items/page.tsx");
    expect(page).toContain("/items/history?item=");
    const history = src("src/app/(app)/items/history/page.tsx");
    expect(history).toContain("ItemHistoryDetail");
    const detail = src("src/components/ItemHistoryDetail.tsx");
    expect(detail).toContain("Price history");
    expect(detail).toContain("Supplier comparison");
    expect(detail).toContain("Where used");
    expect(detail).toContain("listItemDetailEntries");
    const itemPage = src("src/app/(app)/items/[id]/page.tsx");
    expect(itemPage).toContain("ItemHistoryDetail");
  });
  it("sidebar links to Items", () => {
    expect(src("src/components/Sidebar.tsx")).toContain('href: "/items"');
  });
  it("customer page has a Price history tab with prices only", () => {
    const page = src("src/app/(app)/customers/[id]/page.tsx");
    expect(page).toContain('key: "prices"');
    expect(page).toContain("CustomerPriceHistory");
    expect(page).not.toContain("lastCost");
  });
  it("quote actions offer Duplicate and New revision", () => {
    const actions = src("src/components/docs/QuoteActions.tsx");
    expect(actions).toContain('label: "Duplicate"');
    expect(actions).toContain('label: "New revision"');
    expect(actions).toContain("runAndGo");
  });
  it("copy service resets approval/sent state and refuses void quotes", () => {
    const svc = src("src/lib/services/quotes.ts");
    expect(svc).toContain("copyQuote");
    expect(svc).toContain("buyerPoNo: null");
    expect(svc).toContain("A void quote cannot be copied.");
  });
});
