import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lineCostMissing, linesMissingSupplierCost } from "@/lib/quotes/calc";

// Lot Phase B1 follow-up: the quote RECORD view judged a lot line's cost by
// its own supplierUnitCost (always 0 for lots), so a fully-costed lot showed
// "Cost not set" in the Margin column. The check must be lot-aware.
describe("lineCostMissing", () => {
  it("normal line: missing when blank or zero, present when set", () => {
    expect(lineCostMissing({ supplierUnitCost: "" })).toBe(true);
    expect(lineCostMissing({ supplierUnitCost: "0.00" })).toBe(true);
    expect(lineCostMissing({ supplierUnitCost: "250.00" })).toBe(false);
  });

  it("lot line: present when every component has a cost", () => {
    expect(
      lineCostMissing({
        supplierUnitCost: "0.00",
        isLot: true,
        components: [{ unitCost: "300000.00" }, { unitCost: "100000.00" }],
      })
    ).toBe(false);
  });

  it("lot line: missing when any component has no cost", () => {
    expect(
      lineCostMissing({
        isLot: true,
        components: [{ unitCost: "300000.00" }, { unitCost: "0.00" }],
      })
    ).toBe(true);
  });

  it("lot line: missing with no components at all", () => {
    expect(lineCostMissing({ isLot: true, components: [] })).toBe(true);
    expect(lineCostMissing({ isLot: true })).toBe(true);
  });

  it("linesMissingSupplierCost scans lots by their components", () => {
    expect(
      linesMissingSupplierCost([
        { supplierUnitCost: "10.00" },
        { isLot: true, components: [{ unitCost: "5.00" }] },
      ])
    ).toBe(false);
    expect(
      linesMissingSupplierCost([
        { supplierUnitCost: "10.00" },
        { isLot: true, components: [{ unitCost: "" }] },
      ])
    ).toBe(true);
  });
});

describe("record view wiring", () => {
  const docParts = readFileSync(
    join(process.cwd(), "src/components/docs/DocParts.tsx"),
    "utf8"
  );

  it("the margin cell uses the lot-aware check", () => {
    expect(docParts).toContain("lineCostMissing(i) ? COST_NOT_SET_LABEL");
  });

  it("a lot row shows Lot in the supplier cell, not a blank dash", () => {
    expect(docParts).toContain('i.isLot ? <span className="faint">Lot</span>');
  });
});
