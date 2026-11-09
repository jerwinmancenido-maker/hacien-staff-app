// Lot plan Phase A — the quote editor fills a line's unit cost from the
// picked supplier's last PO cost for the same description, but only when
// the cost box is still empty. These tests pin the fill rules and the
// editor/route wiring.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { costIsEmpty, lastCostHint, pickSupplierCost, type SupplierCostRow } from "@/lib/quotes/last-cost";

const read = (p: string) => readFileSync(p, "utf8");

const ROWS: SupplierCostRow[] = [
  { supplierId: "sup-a", supplierName: "Supplier A", lastCost: "2100", lastCostDate: "2026-11-08", poNumber: "PO-2026-0009" },
  { supplierId: "sup-b", supplierName: "Supplier B", lastCost: "1950.5", lastCostDate: "2026-10-01", poNumber: "PO-2026-0003" },
];

describe("costIsEmpty", () => {
  it("treats blank and zero as empty", () => {
    expect(costIsEmpty("")).toBe(true);
    expect(costIsEmpty("   ")).toBe(true);
    expect(costIsEmpty("0")).toBe(true);
    expect(costIsEmpty("0.00")).toBe(true);
  });

  it("treats any typed amount as filled, commas included", () => {
    expect(costIsEmpty("0.50")).toBe(false);
    expect(costIsEmpty("2,100")).toBe(false);
    expect(costIsEmpty("2,100.00")).toBe(false);
  });

  it("never treats typed non-numeric text as empty (no overwrite)", () => {
    expect(costIsEmpty("abc")).toBe(false);
    expect(costIsEmpty("1,2,3")).toBe(false); // Number("123")... guard below
  });
});

describe("pickSupplierCost + hint", () => {
  it("finds the picked supplier's row and formats the hint", () => {
    const row = pickSupplierCost(ROWS, "sup-a");
    expect(row?.poNumber).toBe("PO-2026-0009");
    expect(lastCostHint(row!)).toBe("Last cost ₱2,100.00 · PO-2026-0009 · 2026-11-08");
  });

  it("returns null when the supplier has no history", () => {
    expect(pickSupplierCost(ROWS, "sup-none")).toBeNull();
    expect(pickSupplierCost([], "sup-a")).toBeNull();
  });
});

describe("wiring", () => {
  it("the API route serves the supplier price comparison behind the cost permission", () => {
    const route = read("src/app/api/items/supplier-costs/route.ts");
    expect(route).toContain("listSupplierPriceComparison");
    expect(route).toContain('requireCostAction("view")');
  });

  it("the quote editor auto-fills on supplier pick and on catalog pick, hinting under both cost inputs", () => {
    const editor = read("src/components/docs/QuoteEditor.tsx");
    expect(editor).toContain("maybeAutoFillCost");
    expect(editor).toContain("/api/items/supplier-costs?description=");
    // Supplier picks arrive from the SearchPicker as plain values (id), not
    // change events — the picker conversion of 2026-11-09 replaced the
    // native selects' ev.target.value wiring (desktop + mobile).
    expect(editor.match(/onSupplierPick\(i, id \|\| null\)/g)).toHaveLength(2);
    expect(editor.match(/costHints\[i\.key\]/g)).toHaveLength(4); // ternary + render, desktop + mobile
    // The fill is guarded: it re-checks emptiness at apply time.
    expect(editor).toContain("costIsEmpty(x.supplierUnitCost)");
  });
});
