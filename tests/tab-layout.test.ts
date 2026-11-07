import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tab layout for the doc pages (quote / SO / PO / billing / collection /
// expense / cash account) and the company pages (customer / supplier).
// Source-level assertions: the pages are server components, so the tests
// pin the tab keys, the labels, and which sections live inside which tab.

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
  it("has an Activity tab and keeps Activity off Overview", () => {
    expect(src).toContain('{ key: "activity", label: "Activity"');
    const overview = sliceBetween(src, '{tab === "overview" && (', '{tab === "sales-orders" && (');
    expect(overview).not.toContain("<Activity");
    const start = src.indexOf('{tab === "activity" && (');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(src.slice(start)).toContain("<Activity");
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
  it("has an Activity tab before Attachments", () => {
    expect(src).toContain('"activity", "attachments"');
    expect(src).toContain('{ key: "activity", label: "Activity"');
    const overview = sliceBetween(src, '{tab === "overview" && (', "    </>\n  );");
    expect(overview).not.toContain("<Activity");
  });
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
    // The link shows even when there are no billings yet — it is not
    // hidden inside the billings.length === 0 branch.
    expect(src).not.toContain("View billings →</Link>\n                </p>\n              )}");
  });
  it("shows the delivery section only in the Deliveries tab", () => {
    const tab = sliceBetween(src, '{tab === "deliveries" && (', '{tab === "attachments" && (');
    expect(tab).toContain("<DeliverySection");
    const overview = sliceBetween(src, '{tab === "overview" && (', "    </>\n  );");
    expect(overview).not.toContain("<DeliverySection");
  });
  it("shows an empty state when the order has no deliveries yet", () => {
    const section = readFileSync("src/components/sales-orders/DeliverySection.tsx", "utf8");
    expect(section).toContain("No deliveries yet.");
  });
});

describe("PO detail tabs", () => {
  const src = read("purchase-orders/[id]/page.tsx");
  it("renders Match next to Bills, Activity before Attachments last", () => {
    const match = src.indexOf('key: "match"');
    const returns = src.indexOf('key: "returns"');
    const activity = src.indexOf('key: "activity"');
    const attachments = src.indexOf('key: "attachments"');
    expect(match).toBeGreaterThan(0);
    expect(match).toBeLessThan(returns);
    expect(returns).toBeLessThan(activity);
    expect(activity).toBeLessThan(attachments);
  });
});

describe("billing detail tabs", () => {
  const src = read("billing/billings/[id]/page.tsx");
  it("labels the allocations tab Allocations", () => {
    expect(src).toContain('label: "Allocations"');
    expect(src).not.toContain('label: "Collections"');
  });
  it("has a real Activity tab and keeps Activity off the top of the page", () => {
    expect(src).toContain('key: "activity", label: "Activity"');
    expect(src).toContain('tab === "activity"');
    const top = src.slice(0, src.indexOf("<PillTabs"));
    expect(top).not.toContain("<Activity");
  });
});

describe("collection detail tabs", () => {
  const src = read("billing/collections/[id]/page.tsx");
  it("has no Overview tab and defaults to Allocations", () => {
    expect(src).not.toContain('{ key: "overview"');
    expect(src).toContain('const tab = raw === "attachments" || raw === "activity" ? raw : "allocations";');
  });
  it("has an Activity tab before Attachments", () => {
    expect(src).toContain('key: "activity", label: "Activity"');
    const activity = src.indexOf('key: "activity"');
    const attachments = src.indexOf('key: "attachments"');
    expect(activity).toBeGreaterThan(0);
    expect(activity).toBeLessThan(attachments);
  });
});

describe("expense detail tabs", () => {
  const src = read("cash/expenses/[id]/page.tsx");
  it("has Activity and Attachments tabs, defaulting to Attachments", () => {
    expect(src).toContain("PillTabs");
    expect(src).toContain('key: "activity", label: "Activity"');
    expect(src).toContain('key: "attachments", label: "Attachments"');
    expect(src).toContain('const tab = raw === "activity" ? raw : "attachments";');
    expect(src).toContain("<h2>Attachments</h2>");
    const top = src.slice(0, src.indexOf("<PillTabs"));
    expect(top).not.toContain("<Activity");
  });
});

describe("cash account detail tabs", () => {
  const src = read("cash/accounts/[id]/page.tsx");
  it("has no Overview tab and defaults to Recent ledger", () => {
    expect(src).not.toContain('{ key: "overview"');
    expect(src).toContain('const tab = raw === "edit" || raw === "ledger" || raw === "activity" ? raw : "ledger";');
    expect(src).toContain('{ key: "ledger", label: "Recent ledger"');
  });
  it("has an Activity tab between Recent ledger and Edit", () => {
    const ledger = src.indexOf('key: "ledger"');
    const activity = src.indexOf('key: "activity"');
    const edit = src.indexOf('key: "edit"');
    expect(ledger).toBeGreaterThan(0);
    expect(ledger).toBeLessThan(activity);
    expect(activity).toBeLessThan(edit);
  });
});

describe("supplier detail tabs", () => {
  const src = read("suppliers/[id]/page.tsx");
  const overview = readFileSync("src/components/SupplierOverview.tsx", "utf8");
  it("has an Activity tab last, after Balances", () => {
    expect(src).toContain('{ key: "activity", label: "Activity"');
    expect(src).toContain('"balances", "activity"] as const');
    const balances = src.indexOf('key: "balances"');
    const activity = src.indexOf('key: "activity"');
    expect(balances).toBeGreaterThan(0);
    expect(balances).toBeLessThan(activity);
  });
  it("keeps Recent activity off Overview and renders it in the Activity tab", () => {
    expect(overview).not.toContain("<Activity");
    expect(overview).not.toContain("docIds");
    const start = src.indexOf('{tab === "activity" && (');
    expect(start).toBeGreaterThanOrEqual(0);
    const tab = src.slice(start);
    expect(tab).toContain("<Activity");
    expect(tab).toContain('entityType: "Supplier"');
    expect(tab).toContain('entityType: "BusinessDocument"');
    expect(tab).toContain('title="Recent activity"');
  });
});

describe("customer detail tabs", () => {
  const src = read("customers/[id]/page.tsx");
  const overview = readFileSync("src/components/CustomerOverview.tsx", "utf8");
  it("has an Activity tab last, after Price history", () => {
    expect(src).toContain('{ key: "activity", label: "Activity"');
    const prices = src.indexOf('key: "prices"');
    const activity = src.indexOf('key: "activity"');
    expect(prices).toBeGreaterThan(0);
    expect(prices).toBeLessThan(activity);
  });
  it("keeps Recent activity off Overview and renders it in the Activity tab", () => {
    expect(overview).not.toContain("<Activity");
    expect(overview).not.toContain("docIds");
    const start = src.indexOf('{tab === "activity" && (');
    expect(start).toBeGreaterThanOrEqual(0);
    const tab = src.slice(start);
    expect(tab).toContain("<Activity");
    expect(tab).toContain('entityType: "Customer"');
    expect(tab).toContain('entityType: "BusinessDocument"');
    expect(tab).toContain('title="Recent activity"');
  });
  it("resolves ?tab=activity through the shared company tab list", () => {
    const tabs = readFileSync("src/lib/company-tabs.ts", "utf8");
    expect(tabs).toContain('"activity"');
  });
});
