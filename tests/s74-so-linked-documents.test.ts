import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-74: sales order 'Documents' tab (renamed from 'Linked documents' by
// the tab-layout change) — source quote, billings, collections and DR
// numbers, each with number, date, amount and status and a link. POs,
// receiving and supplier bills stay in Cost & margin.
// Also the S-87 note: the tab carries a Print link per billing.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-74 SO Linked documents tab", () => {
  it("SO page has a Documents tab for every viewer", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(src).toContain('"documents", "deliveries", "cost-margin"');
    expect(src).toContain('label: "Documents"');
    expect(src).toContain('tab === "documents"');
    // Cost & margin stays gated to cost users.
    expect(src).toContain("so.canSeeCosts");
  });

  it("the tab lists quote, billings, collections and DRs with number, date, amount, status and a link", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    for (const label of ["Source quote", "Billing", "Collection", "Delivery receipt"]) expect(src).toContain(label);
    expect(src).toContain("/quotes/${so.quote.id}");
    expect(src).toContain("/billing/billings/${b.id}");
    expect(src).toContain("/billing/collections/${c.id}");
    // S-87: print link per billing inside the tab.
    expect(src).toContain("/print/billings/${b.id}");
    expect(src).toContain("listSalesOrderCollections(so.id)");
  });

  it("collections for an SO come from their billing allocations", () => {
    const views = read("src/lib/billing/views.ts");
    expect(views).toContain("listSalesOrderCollections");
    expect(views).toContain("allocations: { some: { billing: { salesOrderId } } }");
  });
});
