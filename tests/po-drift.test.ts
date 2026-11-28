// Same-rate drift warning (ERP adoption item 6) — pure-helper behaviour:
// centavo-precision comparison, % wording, the zero-cost SO case, and the
// save-time message. The DB loader is covered in tests/db/po-drift.db.test.ts;
// the editor/action wiring in tests/po-drift-ui.test.ts.
import { describe, expect, it } from "vitest";
import { costDrift, driftEntriesFor, driftLineText, driftWarningMessage } from "@/lib/purchasing/drift";

describe("costDrift — comparison", () => {
  it("exact match at centavo precision warns about nothing", () => {
    expect(costDrift("2500", "2500")).toBeNull();
    expect(costDrift("2,500.00", "2500")).toBeNull();
    expect(costDrift("0", "0.00")).toBeNull();
    // Sub-centavo typing rounds to the same centavo — still an exact match.
    expect(costDrift("2500.004", "2500.00")).toBeNull();
  });

  it("flags higher and lower with the % vs the SO cost", () => {
    expect(costDrift("3000", "2500")).toEqual({ direction: "higher", pct: "20.0" });
    expect(costDrift("2000", "2500")).toEqual({ direction: "lower", pct: "20.0" });
    expect(costDrift("45001", "45000")).toEqual({ direction: "higher", pct: "0.0" });
    expect(costDrift("12000.50", "12000")).toEqual({ direction: "higher", pct: "0.0" });
  });

  it("a one-centavo difference is drift (centavo precision)", () => {
    expect(costDrift("2500.01", "2500")?.direction).toBe("higher");
    expect(costDrift("2499.99", "2500")?.direction).toBe("lower");
  });

  it("SO cost ₱0.00 has no percentage — the wording names the missing cost", () => {
    expect(costDrift("3000", "0")).toEqual({ direction: "higher", pct: null });
  });

  it("unparseable input is no drift (validation reports it separately)", () => {
    expect(costDrift("abc", "2500")).toBeNull();
    expect(costDrift("2500", "")).toEqual({ direction: "higher", pct: null }); // "" reads as the ₱0.00 no-cost case
  });
});

describe("drift text — names both prices and the difference", () => {
  const up = { direction: "higher" as const, pct: "20.0", description: "Laptop i5\n16GB spec", poUnitCost: "3000", soUnitCost: "2500" };
  const noCost = { direction: "higher" as const, pct: null, description: "USB drive", poUnitCost: "100", soUnitCost: "0" };

  it("line text carries PO price, SO price and %", () => {
    const text = driftLineText(up);
    expect(text).toContain('"Laptop i5"');
    expect(text).toContain("₱3,000.00");
    expect(text).toContain("₱2,500.00");
    expect(text).toContain("20.0% higher");
    expect(text).not.toContain("16GB spec"); // first line of the description only
  });

  it("comma-grouped editor input still formats as pesos (never ₱NaN)", () => {
    const text = driftLineText({ ...up, poUnitCost: "3,000", soUnitCost: "2,500" });
    expect(text).toContain("₱3,000.00");
    expect(text).toContain("₱2,500.00");
    expect(text).not.toContain("NaN");
  });

  it("zero-cost SO line text says the cost was never set", () => {
    const text = driftLineText(noCost);
    expect(text).toContain("no cost set");
    expect(text).toContain("₱100.00");
    expect(text).not.toContain("%");
  });

  it("the save-time message counts the lines and says nothing was saved", () => {
    const one = driftWarningMessage([up]);
    expect(one).toContain("One line cost differs from the sales order. Nothing has been saved yet.");
    expect(one).toContain("Save anyway to keep these costs.");
    const two = driftWarningMessage([up, noCost]);
    expect(two).toContain("2 line costs differ from the sales order.");
  });
});

describe("driftEntriesFor — editor-shaped lines", () => {
  it("only linked lines with a differing cost produce entries", () => {
    const entries = driftEntriesFor([
      { description: "Same", unitCost: "500", soUnitCost: "500" },
      { description: "Up", unitCost: "600", soUnitCost: "500" },
      { description: "Standalone", unitCost: "999", soUnitCost: null },
      { description: "No SO cost loaded", unitCost: "999" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ description: "Up", direction: "higher", pct: "20.0" });
  });
});
