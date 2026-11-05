// Audit F: purchasing visible to non-cost users (no money). Source tests
// only; the money-stripping cases live in tests/db/purchasing-visible.db.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("purchasing visible to non-cost users", () => {
  it("the PO list page is open to every viewer and hides money for non-cost users", () => {
    const src = read("src/app/(app)/purchase-orders/page.tsx");
    expect(src).toContain('requirePagePermission("view")');
    expect(src).not.toContain("requireCostPage");
    expect(src).toContain("withCosts");
    expect(src).toContain("Bill higher than PO");
    expect(src).toContain("withCosts && (");
    expect(src).toContain('...(withCosts ? [{ key: "total"');
  });

  it("the PO detail page is open to every viewer; bills/match and money are cost-only", () => {
    const src = read("src/app/(app)/purchase-orders/[id]/page.tsx");
    expect(src).toContain('requirePagePermission("view")');
    expect(src).not.toContain("requireCostPage");
    expect(src).toContain("Bills and Match are money tabs");
    expect(src).toContain("canEdit={canEdit && po.canSeeCosts}");
    expect(src).toContain("po.canSeeCosts && <th className=\"num\">Unit cost</th>");
    expect(src).toContain("{po.canSeeCosts && (");
  });

  it("the list/detail views strip money for non-cost viewers", () => {
    const src = read("src/lib/purchasing/views.ts");
    expect(src).toContain("subtotal: withCosts ? money(r.subtotal) : null");
    expect(src).toContain("bills: []");
    expect(src).toContain("match: null");
    expect(src).toContain("unitCost: null, total: null");
    expect(src).toContain("canSeeCosts: withCosts");
  });

  it("the sidebar shows Supplier POs to every viewer", () => {
    const src = read("src/components/Sidebar.tsx");
    expect(src).toContain('{ href: "/purchase-orders", label: "Supplier POs", icon: <BoxIcon /> }');
    expect(src).not.toContain("costsOnly: true");
  });

  it("the SO Documents tab lists purchase orders for everyone", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(src).toContain("purchasing.purchaseOrders.map((p) => (");
    expect(src).toContain("Purchase order · {p.supplierName}");
    expect(src).toContain("Receiving and supplier bills stay in the Cost &amp; margin tab.");
  });

  it("PO mutations still fail closed for non-cost users", () => {
    const src = read("src/lib/services/purchase-orders.ts");
    expect(src).toContain("if (!canSeeCosts(actor)) throw new ForbiddenError();");
  });
});
