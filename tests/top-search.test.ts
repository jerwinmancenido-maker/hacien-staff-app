import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOP_SEARCH_GROUP_LIMIT,
  TOP_SEARCH_MIN_Q,
  mergeReceivingSearchRows,
  normalizeTopSearchQuery,
  receivingSeeAllHref,
  takeTopSearchHits,
  topSearchListHref,
} from "@/lib/search/top-search";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("top search query length", () => {
  it("requires at least 2 non-space characters", () => {
    expect(TOP_SEARCH_MIN_Q).toBe(2);
    expect(normalizeTopSearchQuery("")).toBeNull();
    expect(normalizeTopSearchQuery(" ")).toBeNull();
    expect(normalizeTopSearchQuery("a")).toBeNull();
    expect(normalizeTopSearchQuery(" a ")).toBeNull();
    expect(normalizeTopSearchQuery("ab")).toBe("ab");
    expect(normalizeTopSearchQuery("  QT-1  ")).toBe("QT-1");
  });

  it("coerces string[] searchParams (first value) and ignores non-strings", () => {
    expect(normalizeTopSearchQuery(["ab", "cd"])).toBe("ab");
    expect(normalizeTopSearchQuery(["  QT-1  ", "other"])).toBe("QT-1");
    expect(normalizeTopSearchQuery(["x"])).toBeNull();
    expect(normalizeTopSearchQuery([])).toBeNull();
    expect(normalizeTopSearchQuery(undefined)).toBeNull();
    expect(normalizeTopSearchQuery(null)).toBeNull();
  });
});

describe("top search helpers", () => {
  it("builds list hrefs with the same q", () => {
    expect(topSearchListHref("/sales-orders", "SN-9")).toBe("/sales-orders?q=SN-9");
    expect(topSearchListHref("/billing/billings", "ac me")).toBe("/billing/billings?q=ac+me");
    expect(topSearchListHref("/receiving", "SN-9", { history: "1" })).toBe("/receiving?q=SN-9&history=1");
  });

  it("caps each group at 5 hits", () => {
    expect(TOP_SEARCH_GROUP_LIMIT).toBe(5);
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `R${i}` }));
    const hits = takeTopSearchHits(rows, (r) => ({
      id: r.id,
      href: `/x/${r.id}`,
      primary: r.name,
      secondary: "Cust",
      status: "Open",
    }));
    expect(hits).toHaveLength(5);
    expect(hits[0]?.primary).toBe("R0");
    expect(hits[4]?.primary).toBe("R4");
  });

  it("merges receiving open + history without duplicate ids", () => {
    const open = [{ id: "a", number: "PO-1" }, { id: "b", number: "PO-2" }];
    const history = [{ id: "b", number: "PO-2" }, { id: "c", number: "PO-3" }];
    expect(mergeReceivingSearchRows(open, history).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("adds history=1 on Receiving See all when shown hits are history-only", () => {
    const openIds = new Set(["a"]);
    expect(receivingSeeAllHref("SN", openIds, ["a"])).toBe("/receiving?q=SN");
    expect(receivingSeeAllHref("SN", openIds, ["c"])).toBe("/receiving?q=SN&history=1");
    expect(receivingSeeAllHref("SN", openIds, ["a", "c"])).toBe("/receiving?q=SN&history=1");
  });
});

describe("top search wiring", () => {
  it("breadcrumb labels Search for /search", async () => {
    const { breadcrumbLabelsForPath } = await import("@/components/Sidebar");
    expect(breadcrumbLabelsForPath("/search")).toEqual(["Search"]);
  });

  it("header search is a GET form to /search and no longer read-only", () => {
    const src = read("src/components/TopbarSearch.tsx");
    expect(src).not.toMatch(/readOnly/);
    expect(src).toContain('action="/search"');
    expect(src).toContain('method="get"');
    expect(src).toContain('name="q"');
    expect(src).toContain("normalizeTopSearchQuery");
    expect(src).toContain("metaKey");
    expect(src).toContain("ctrlKey");
    expect(src).toContain('e.key === "Escape"');
  });

  it("search page calls each list with q and the same permissions", () => {
    const src = read("src/app/(app)/search/page.tsx");
    expect(src).toContain('requirePagePermission("view")');
    expect(src).toContain("listQuotesView({ q }, user)");
    expect(src).toContain("listSalesOrdersView({ q })");
    expect(src).toContain("listCustomers({ q, matchTin: showTin, take: TOP_SEARCH_GROUP_LIMIT })");
    expect(src).toContain("listSuppliers({ q, matchTin: showTin, take: TOP_SEARCH_GROUP_LIMIT })");
    expect(src).toContain("listPurchaseOrdersView({ q }, user)");
    expect(src).toContain("listReceivingView({ q }, user)");
    expect(src).toContain("listReceivingView({ q, history: true }, user)");
    expect(src).toContain("listBillings({ q })");
    expect(src).toContain("receivingSeeAllHref");
    expect(src).toContain("See all in Sales orders →");
    expect(src).toContain('title="No matches"');
    expect(src).toContain("Try a number, a name, or a serial.");
    expect(src).not.toMatch(/formatPeso|contractPrice|subtotal|\.amount|\.balance/);
  });
});
