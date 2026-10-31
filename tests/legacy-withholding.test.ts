import { describe, expect, it } from "vitest";
import {
  LEGACY_WITHHOLDING_REAPPLY_REQUIRED,
  preserveLegacyWithholdingOnSave,
  rateFromDocWithholding,
} from "@/lib/quotes/legacy-withholding";
import type { PlannedItem } from "@/lib/quotes/items";

function line(partial: Partial<PlannedItem> & Pick<PlannedItem, "kind" | "withholdingRate">): PlannedItem {
  return {
    id: "i1",
    sortOrder: 0,
    description: "Line",
    qty: "1.00",
    unit: "pc",
    supplierId: null,
    supplierUnitCost: "0.00",
    unitPrice: "100.00",
    total: "100.00",
    supplierTotal: "0.00",
    margin: "100.00",
    withholdingAtc: null,
    withholdingOverride: false,
    ...partial,
  };
}

const beforeWithWh = {
  contractPrice: "100.00",
  withholdingTotal: "3.00",
  netReceived: "97.00",
  supplierCost: "0.00",
  netMargin: "97.00",
  netMarginPct: "97.00",
  withholding: [
    { code: "GOV_PT_3", label: "Gov PT", lineKind: "GOV_PT", rate: "0.0300", atcCode: "WB080" },
    { code: "GOV_VAT_5", label: "VAT withheld 5%", lineKind: "GOV_VAT", rate: "0.0500", atcCode: "WV010/WV020" },
  ],
};

describe("rateFromDocWithholding", () => {
  it("prefers GOV_PT over GOV_VAT when both are in the document JSON", () => {
    expect(rateFromDocWithholding(beforeWithWh.withholding, "GOODS")).toEqual({
      withholdingRate: "0.0300",
      withholdingAtc: "WB080",
    });
  });
});

describe("preserveLegacyWithholdingOnSave", () => {
  it("lets an explicit 0% clear save through as ₱0", () => {
    const result = preserveLegacyWithholdingOnSave(beforeWithWh, [
      line({ kind: "GOODS", withholdingRate: "0.0000", withholdingOverride: true }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preserved).toBe(false);
    expect(result.totals.withholdingTotal).toBe("0.00");
  });

  it("backfills true legacy NULL rates from the doc JSON", () => {
    const result = preserveLegacyWithholdingOnSave(beforeWithWh, [
      line({ kind: "GOODS", withholdingRate: null }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preserved).toBe(true);
    expect(result.totals.withholdingTotal).toBe("3.00");
    expect(result.items[0]!.withholdingRate).toBe("0.0300");
  });

  it("fails closed when the JSON cannot supply rates for legacy NULL lines", () => {
    const result = preserveLegacyWithholdingOnSave(
      { ...beforeWithWh, withholding: [] },
      [line({ kind: "GOODS", withholdingRate: null })],
    );
    expect(result).toEqual({ ok: false, message: LEGACY_WITHHOLDING_REAPPLY_REQUIRED });
  });
});
