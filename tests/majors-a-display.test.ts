import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * VR1 majors A (D8 / lot trap / D33), wiring level. These pin the display
 * rules so a later edit cannot silently reintroduce them: a margin percent
 * printed as fact over "Cost not set" lines, a lot description field the
 * user cannot find, an AR note that says "Nothing billed yet" over a paid
 * billing, and a cost tab whose ₱0.00 and ₱50 never meet.
 * (The profit-side rule itself is pinned against the real module in
 * tests/deal-margin-rounding.test.ts; the AR flag against MySQL in
 * tests/db/billing.db.test.ts.)
 */
describe("D8: no margin percent while cost is missing", () => {
  it("quote editor totals drop the percent in the partial state", () => {
    const f = src("src/components/docs/QuoteEditor.tsx");
    expect(f).toContain('totals.supplierCostState === "partial"');
    expect(f).toContain('"Margin so far"');
  });

  it("read-view totals box drops the percent in the partial state", () => {
    const f = src("src/components/docs/DocParts.tsx");
    expect(f).toContain('state === "partial" ? "—"');
    expect(f).toContain('state === "partial" ? "Margin so far" : "Margin"');
  });

  it("customer transactions guard the margin pair on the cost state", () => {
    const f = src("src/components/TransactionsTab.tsx");
    expect(f).toContain("supplierCostMissing(r.supplierCost)");
    expect(f).toContain("COST_NOT_SET_LABEL");
  });

  it("PO detail flags a ₱0.00 line cost instead of printing it silently", () => {
    const f = src("src/app/(app)/purchase-orders/[id]/page.tsx");
    expect(f).toContain("supplierCostMissing(i.unitCost) ? COST_NOT_SET_LABEL : formatPeso(i.unitCost!)");
  });
});

describe("lot-editor trap: the lot's description field asks for the name", () => {
  it("lot lines get a lot-name label, placeholder and hint in the editor", () => {
    const f = src("src/components/docs/QuoteEditor.tsx");
    expect(f).toContain("lot name / description");
    expect(f).toContain("Lot name / description — prints as the lot's spec text");
    expect(f).toContain("This is the lot");
    // Both editor layouts (list + card) render the field.
    expect(f.split("Lot name / description — prints as the lot's spec text").length - 1).toBe(2);
  });
});

describe("D33: AR note and cost tab reconcile their own numbers", () => {
  it("the AR snapshot reports whether the customer was ever billed", () => {
    const f = src("src/lib/billing/views.ts");
    expect(f).toContain("hasBillings: billings.length > 0");
  });

  it("the overview note says 'Nothing outstanding.' when billings exist but are paid", () => {
    const f = src("src/components/CustomerOverview.tsx");
    expect(f).toContain('ar.hasBillings ? "Nothing outstanding." : "Nothing billed yet."');
  });

  it("the cost & margin tab explains PO-total cost beside 'Cost so far'", () => {
    const f = src("src/components/purchasing/SoCostMarginTab.tsx");
    expect(f).toContain("on order (PO total) — not yet received or billed.");
    expect(f).toContain("toScaled(summary.totalCost, 2) > toScaled(summary.incurredCost, 2)");
  });
});
