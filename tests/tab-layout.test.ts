import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tab layout for the doc pages (quote / SO / PO / billing / collection /
// expense / cash account). Source-level assertions: the pages are server
// components, so the tests pin the tab keys, the labels, and which sections
// live inside which tab.

const read = (p: string) => readFileSync(`src/app/(app)/${p}`, "utf8");

const sliceBetween = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
};

describe("quote detail tabs", () => {
  const src = read("quotes/[id]/page.tsx");
  it("has Overview, Sales orders and Conforme tabs with counts", () => {
    expect(src).toContain('{ key: "overview", label: "Overview"');
    expect(src).toContain('{ key: "sales-orders", label: "Sales orders", count: q.salesOrders.length');
    expect(src).toContain('{ key: "conforme", label: "Conforme", count: q.conformeFiles.length');
  });
  it("keeps Items and the conforme status strip on Overview", () => {
    const overview = sliceBetween(src, '{tab === "overview" && (', '{tab === "sales-orders" && (');
    expect(overview).toContain("<h2>Items</h2>");
    expect(overview).toContain("Conforme:");
    expect(overview).toContain('"missing"');
    expect(overview).toContain("Sales orders:");
  });
  it("shows the sales-orders table only in its tab", () => {
    const tab = sliceBetween(src, '{tab === "sales-orders" && (', '{tab === "conforme" && (');
    expect(tab).toContain("Sales orders from this quote");
    expect(tab).not.toContain("<h2>Items</h2>");
  });
  it("shows the conforme files only in its tab", () => {
    const start = src.indexOf('{tab === "conforme" && (');
    expect(start).toBeGreaterThanOrEqual(0);
    const tab = src.slice(start);
    expect(tab).toContain("Signed conforme");
    expect(tab).toContain("ConformeUploadForm");
  });
});

describe("SO detail tabs", () => {
  const src = read("sales-orders/[id]/page.tsx");
  it("has a Deliveries tab with a count", () => {
    expect(src).toContain('"deliveries"');
    expect(src).toContain('{ key: "deliveries", label: "Deliveries", count: deliveries.length');
  });
  it("calls the linked-documents tab Documents, not Linked documents", () => {
    expect(src).toContain('label: "Documents"');
    expect(src).not.toContain("Linked documents");
  });
  it("keeps the billings table off Overview", () => {
    expect(src).not.toContain("so-bill-desk");
    expect(src).not.toContain("so-bill-phone");
    const overview = sliceBetween(src, '{tab === "overview" && (', "    </>\n  );");
    expect(overview).toContain("View billings →");
    expect(overview).toContain("Deliveries:");
  });
  it("shows the delivery section only in the Deliveries tab", () => {
    const tab = sliceBetween(src, '{tab === "deliveries" && (', '{tab === "attachments" && (');
    expect(tab).toContain("<DeliverySection");
    const overview = sliceBetween(src, '{tab === "overview" && (', "    </>\n  );");
    expect(overview).not.toContain("<DeliverySection");
  });
});

describe("PO detail tabs", () => {
  const src = read("purchase-orders/[id]/page.tsx");
  it("renders Match next to Bills, Attachments last", () => {
    const match = src.indexOf('key: "match"');
    const returns = src.indexOf('key: "returns"');
    const attachments = src.indexOf('key: "attachments"');
    expect(match).toBeGreaterThan(0);
    expect(match).toBeLessThan(returns);
    expect(returns).toBeLessThan(attachments);
  });
});

describe("billing detail tabs", () => {
  const src = read("billing/billings/[id]/page.tsx");
  it("labels the allocations tab Allocations and drops the dead activity key", () => {
    expect(src).toContain('label: "Allocations"');
    expect(src).not.toContain('label: "Collections"');
    expect(src).not.toContain('"activity"');
  });
});

describe("collection detail tabs", () => {
  const src = read("billing/collections/[id]/page.tsx");
  it("has no Overview tab and defaults to Allocations", () => {
    expect(src).not.toContain('{ key: "overview"');
    expect(src).toContain('const tab = raw === "attachments" ? raw : "allocations";');
  });
});

describe("expense detail tabs", () => {
  const src = read("cash/expenses/[id]/page.tsx");
  it("has no tab row; attachments render directly", () => {
    expect(src).not.toContain("PillTabs");
    expect(src).toContain("<h2>Attachments</h2>");
  });
});

describe("cash account detail tabs", () => {
  const src = read("cash/accounts/[id]/page.tsx");
  it("has no Overview tab and defaults to Recent ledger", () => {
    expect(src).not.toContain('{ key: "overview"');
    expect(src).toContain('const tab = raw === "edit" || raw === "ledger" ? raw : "ledger";');
    expect(src).toContain('{ key: "ledger", label: "Recent ledger"');
  });
});
