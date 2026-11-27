import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { billingListHref, type BillingListSearch } from "@/lib/billing/list-href";

// Disposition Group A (finding 1103): the Billings + Collections lists
// filtered through date boxes + a Filter submit button while Quotes / Sales
// Orders filter instantly. Status is now filter chips and search + dates
// navigate immediately; both go through billingListHref param patching.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const params = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

describe("billingListHref param patching", () => {
  const current: BillingListSearch = {
    q: "tesda",
    status: "OPEN",
    customerId: "cust-123",
    from: "2026-11-01",
    to: "2026-11-30",
    page: "3",
    pageSize: "50",
  };

  it("a status chip patch keeps customerId, search, dates and pageSize", () => {
    const p = params(billingListHref("/billing/billings", current, { status: "OVERDUE" }));
    expect(p.get("status")).toBe("OVERDUE");
    expect(p.get("customerId")).toBe("cust-123");
    expect(p.get("q")).toBe("tesda");
    expect(p.get("from")).toBe("2026-11-01");
    expect(p.get("to")).toBe("2026-11-30");
    expect(p.get("pageSize")).toBe("50");
  });

  it("a filter change restarts at page 1 (page param dropped)", () => {
    const p = params(billingListHref("/billing/billings", current, { status: "PAID" }));
    expect(p.has("page")).toBe(false);
  });

  it("a patch that names the page keeps it", () => {
    const p = params(billingListHref("/billing/billings", current, { page: "2" }));
    expect(p.get("page")).toBe("2");
  });

  it("clearing the status (All chip) drops only the status param", () => {
    const p = params(billingListHref("/billing/billings", current, { status: undefined }));
    expect(p.has("status")).toBe(false);
    expect(p.get("customerId")).toBe("cust-123");
    expect(p.get("q")).toBe("tesda");
  });

  it("a search patch keeps the status and customerId and restarts paging", () => {
    const p = params(billingListHref("/billing/billings", current, { q: "bl-2026" }));
    expect(p.get("q")).toBe("bl-2026");
    expect(p.get("status")).toBe("OPEN");
    expect(p.get("customerId")).toBe("cust-123");
    expect(p.has("page")).toBe(false);
  });

  it("a date patch keeps the rest and restarts paging", () => {
    const p = params(billingListHref("/billing/collections", { status: "POSTED", page: "2" }, { from: "2026-11-05" }));
    expect(p.get("from")).toBe("2026-11-05");
    expect(p.get("status")).toBe("POSTED");
    expect(p.has("page")).toBe(false);
  });

  it("no params at all returns the bare path", () => {
    expect(billingListHref("/billing/collections", {}, { status: undefined })).toBe("/billing/collections");
  });
});

describe("Billings list — instant filters (finding 1103)", () => {
  const src = read("src/app/(app)/billing/billings/page.tsx");

  it("status renders as filter chips: All, Overdue, and every billing status", () => {
    expect(src).toContain("filter-chip");
    expect(src).toContain("BILLING_STATUSES.map");
    expect(src).toContain("BILLING_STATUS_LABELS[t]");
    expect(src).toContain("{ status: \"OVERDUE\" }");
    expect(src).toContain("{ status: undefined }");
  });

  it("chips and controls patch through the shared href helper", () => {
    expect(src).toContain("billingListHref(");
    expect(src).toContain("<BillingListFilters");
    expect(src).toContain("basePath=\"/billing/billings\"");
  });

  it("the status select and the Filter submit button are gone", () => {
    expect(src).not.toContain("name=\"status\"");
    expect(src).not.toContain("type=\"submit\"");
    expect(src).not.toContain("method=\"get\"");
  });

  it("customerId still threads from searchParams into the filter params", () => {
    expect(src).toContain("customerId: sp.customerId");
  });

  it("the loader call is unchanged", () => {
    expect(src).toContain("listBillingsPage({");
    expect(src).toContain("customerId: sp.customerId");
  });
});

describe("Collections list — instant filters (finding 1103)", () => {
  const src = read("src/app/(app)/billing/collections/page.tsx");

  it("status renders as filter chips: All, Posted, Void", () => {
    expect(src).toContain("filter-chip");
    expect(src).toContain("{ status: \"POSTED\" }");
    expect(src).toContain("{ status: \"VOID\" }");
    expect(src).toContain("{ status: undefined }");
  });

  it("chips and controls patch through the shared href helper", () => {
    expect(src).toContain("billingListHref(");
    expect(src).toContain("<BillingListFilters");
    expect(src).toContain("basePath=\"/billing/collections\"");
  });

  it("the status select and the Filter submit button are gone", () => {
    expect(src).not.toContain("name=\"status\"");
    expect(src).not.toContain("type=\"submit\"");
    expect(src).not.toContain("method=\"get\"");
  });

  it("the loader call is unchanged", () => {
    expect(src).toContain("listCollections({ status, q: sp.q, fromYmd, toYmd })");
  });
});

describe("BillingListFilters client component", () => {
  const src = read("src/components/billing/BillingListFilters.tsx");

  it("is a client component that navigates through the router", () => {
    expect(src).toContain("\"use client\"");
    expect(src).toContain("useRouter");
    expect(src).toContain("router.push(billingListHref(");
  });

  it("renders visible From and To labels around the date inputs", () => {
    expect(src).toMatch(/<label className="small faint">\s*From/);
    expect(src).toMatch(/<label className="small faint">\s*To/);
    expect(src).toContain("type=\"date\"");
  });

  it("has no submit button — every control navigates on change", () => {
    expect(src).not.toContain("type=\"submit\"");
    expect(src).toContain("onChange");
  });
});
