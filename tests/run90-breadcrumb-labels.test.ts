// Run-90 fix F-1 (finding 1307): the breadcrumb did not name the record on
// 6 of 12 record page types — collection, item, contact, supplier payment,
// cash account, receiving per-PO. Those pages now register their record's
// own label on the SAME RecordBreadcrumbLabel mechanism PR #317 built for
// the first six (quote, sales order, purchase order, billing, customer,
// supplier). Closure requires re-measuring ALL 12 types, so this file pins
// all 12: the path -> trail mapping with a supplied label, the no-label
// fallback for the six new types, and the per-page registration itself.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ID = "cmwl1hxt000073ytuboqn00gz"; // cuid-shaped record segment

// [page file, exact registration, path, label the page supplies, expected trail]
const RECORD_PAGES: Array<[string, string, string, string, string[]]> = [
  ["src/app/(app)/quotes/[id]/page.tsx", "<RecordBreadcrumbLabel label={q.number} />", `/quotes/${ID}`, "QT-2026-0038", ["Quotes", "QT-2026-0038"]],
  ["src/app/(app)/sales-orders/[id]/page.tsx", "<RecordBreadcrumbLabel label={so.number} />", `/sales-orders/${ID}`, "SO-2026-0011", ["Sales Orders", "SO-2026-0011"]],
  ["src/app/(app)/purchase-orders/[id]/page.tsx", "<RecordBreadcrumbLabel label={po.number} />", `/purchase-orders/${ID}`, "PO-2026-0007", ["Supplier POs", "PO-2026-0007"]],
  ["src/app/(app)/billing/billings/[id]/page.tsx", "<RecordBreadcrumbLabel label={b.number} />", `/billing/billings/${ID}`, "BL-2026-0003", ["Billing & Collections", "Billings", "BL-2026-0003"]],
  ["src/app/(app)/customers/[id]/page.tsx", "<RecordBreadcrumbLabel label={customer.name} />", `/customers/${ID}`, "Juan Dela Cruz", ["Customers", "Juan Dela Cruz"]],
  ["src/app/(app)/suppliers/[id]/page.tsx", "<RecordBreadcrumbLabel label={supplier.name} />", `/suppliers/${ID}`, "Acme Supplies", ["Suppliers", "Acme Supplies"]],
  ["src/app/(app)/billing/collections/[id]/page.tsx", "<RecordBreadcrumbLabel label={c.number} />", `/billing/collections/${ID}`, "COL-2026-0005", ["Billing & Collections", "Collections", "COL-2026-0005"]],
  ["src/app/(app)/items/[id]/page.tsx", "<RecordBreadcrumbLabel label={item.name} />", `/items/${ID}`, "Widget A", ["Items", "Widget A"]],
  ["src/app/(app)/contacts/[id]/page.tsx", "<RecordBreadcrumbLabel label={contact.name} />", `/contacts/${ID}`, "Maria Clara", ["Contacts", "Maria Clara"]],
  ["src/app/(app)/payables/payments/[id]/page.tsx", "<RecordBreadcrumbLabel label={p.number} />", `/payables/payments/${ID}`, "SP-2026-0002", ["Payables", "Payments", "SP-2026-0002"]],
  ["src/app/(app)/cash/accounts/[id]/page.tsx", "<RecordBreadcrumbLabel label={account.name} />", `/cash/accounts/${ID}`, "Cash on hand", ["Cash", "Accounts", "Cash on hand"]],
  ["src/app/(app)/receiving/[poId]/page.tsx", "<RecordBreadcrumbLabel label={po.number} />", `/receiving/${ID}`, "PO-2026-0007", ["Receiving", "PO-2026-0007"]],
];

describe("run-90 F-1 breadcrumb record labels (finding 1307)", () => {
  it("names the record on all 12 record page types when the page supplies its label", async () => {
    const { breadcrumbLabelsForPath } = await import("@/components/Sidebar");
    for (const [, , path, label, expected] of RECORD_PAGES) {
      expect(breadcrumbLabelsForPath(path, label), path).toEqual(expected);
    }
  });

  it("registers the record's own label on all 12 record pages", () => {
    for (const [file, registration] of RECORD_PAGES) {
      expect(readFileSync(file, "utf8"), file).toContain(registration);
    }
  });

  it("ends the trail at the section name for the six new types when no label is supplied", async () => {
    const { breadcrumbLabelsForPath } = await import("@/components/Sidebar");
    // The pre-fix behaviour on these six: without a supplied label the
    // record segment drops out. The pages above now always supply one.
    expect(breadcrumbLabelsForPath(`/billing/collections/${ID}`)).toEqual(["Billing & Collections", "Collections"]);
    expect(breadcrumbLabelsForPath(`/items/${ID}`)).toEqual(["Items"]);
    expect(breadcrumbLabelsForPath(`/contacts/${ID}`)).toEqual(["Contacts"]);
    expect(breadcrumbLabelsForPath(`/payables/payments/${ID}`)).toEqual(["Payables", "Payments"]);
    expect(breadcrumbLabelsForPath(`/cash/accounts/${ID}`)).toEqual(["Cash", "Accounts"]);
    expect(breadcrumbLabelsForPath(`/receiving/${ID}`)).toEqual(["Receiving"]);
  });
});
