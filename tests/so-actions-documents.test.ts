import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Adoption item 12: SO Actions / Documents completion.
// (1) "Record delivery" joins the Actions menu, deep-linking into the
//     existing Deliveries-tab form (never a second form), shown only
//     while a delivery can actually be recorded.
// (2) The Documents tab groups every linked document by type with its
//     true count; VOID purchase orders join the live ones, marked VOID.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("adoption item 12 — Record delivery in the SO Actions menu", () => {
  it("the menu item deep-links to the Deliveries tab with the form open", () => {
    const src = read("src/components/docs/QuoteActions.tsx");
    expect(src).toContain('key: "record-delivery", label: "Record delivery"');
    expect(src).toContain("?tab=deliveries&record=1");
    expect(src).toContain("if (canRecordDelivery) items.push");
    expect(src).toContain("canRecordDelivery?: boolean");
  });

  it("the page gates it exactly like the delivery section, plus remaining qty", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(src).toContain("soHasRemainingToDeliver");
    expect(src).toContain('so.status === "OPEN"');
    expect(src).toContain('can(user, "edit_data")');
    expect(src).toContain("canRecordDelivery={canRecordDelivery}");
    // The section's own gate is untouched.
    const section = read("src/components/sales-orders/DeliverySection.tsx");
    expect(section).toContain('canEdit && status === "OPEN" && !showForm');
  });

  it("the deep link opens the existing form via startOpen — no second form", () => {
    const page = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(page).toContain('startOpen={record === "1"}');
    const section = read("src/components/sales-orders/DeliverySection.tsx");
    expect(section).toContain("startOpen?: boolean");
    expect(section).toContain("useState(startOpen)");
    expect(section).toContain("startOpen ? remainingMap() : {}");
  });
});

describe("adoption item 12 — Documents tab grouped by type with counts", () => {
  const src = read("src/app/(app)/sales-orders/[id]/page.tsx");

  it("renders one DocGroup per type, each carrying its count", () => {
    expect(src).toContain('<DocGroup label="Source" count={sourceCount}>');
    expect(src).toContain('<DocGroup label="Billings" count={billings.length}>');
    expect(src).toContain('<DocGroup label="Collections" count={collections.length}>');
    expect(src).toContain('<DocGroup label="Delivery receipts" count={deliveries.length}>');
    expect(src).toContain('<DocGroup label="Purchase orders" count={documentPurchaseOrders.length}>');
    expect(src).toContain("None yet.");
  });

  it("the tab badge is the true grouped total (no unconditional +1)", () => {
    expect(src).toContain(
      "count: billings.length + collections.length + deliveries.length + documentPurchaseOrders.length + sourceCount",
    );
    expect(src).toContain("const sourceCount = (so.quote ? 1 : 0) + (so.storeOrder ? 1 : 0);");
  });

  it("VOID POs are fetched for the tab and join the live rows, marked by status", () => {
    expect(src).toContain('where: { salesOrderId: so.id, status: "VOID" }');
    expect(src).toContain("const documentPurchaseOrders = [...purchasing.purchaseOrders, ...voidPurchaseOrders];");
    expect(src).toContain("documentPurchaseOrders.map((p) => (");
    // The VOID row total stays cost-only, like the live rows.
    expect(src).toContain('...(so.canSeeCosts ? { total: po.subtotal.toString() } : {})');
  });

  it("getSoPurchasing still returns live POs only (progress maths unchanged)", () => {
    const views = read("src/lib/purchasing/views.ts");
    expect(views).toContain('where: { salesOrderId, status: { not: "VOID" } }');
  });
});
