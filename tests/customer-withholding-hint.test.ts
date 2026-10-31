import { describe, expect, it } from "vitest";
import {
  customerWithholdingHint,
  customerWithholdingChipLabel,
  WITHHOLDING_HINT_NOT_SET,
  WITHHOLDING_HINT_NONE,
} from "@/lib/quotes/customer-withholding-hint";
import { WITHHOLDING_DEFAULT_ROWS } from "@/lib/quotes/withholding-defaults";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";

function snap(code: keyof typeof WITHHOLDING_DEFAULT_ROWS): WithholdingSnapshot {
  const row = WITHHOLDING_DEFAULT_ROWS[code];
  return {
    code: row.code,
    label: row.label,
    lineKind: row.lineKind,
    rate: row.rate,
    atcCode: row.atcCode,
  };
}

describe("customerWithholdingHint (pick-based re-export)", () => {
  it("not set / none / picked labels", () => {
    expect(customerWithholdingHint(null)).toBe(WITHHOLDING_HINT_NOT_SET);
    expect(customerWithholdingHint(undefined)).toBe(WITHHOLDING_HINT_NOT_SET);
    expect(customerWithholdingHint([])).toBe(WITHHOLDING_HINT_NONE);
    expect(customerWithholdingHint([snap("GOODS_1")])).toBe("Withholding: Goods 1% (WI158)");
    expect(customerWithholdingHint([snap("GOODS_1"), snap("GOV_PT_3")])).toBe(
      "Withholding: Goods 1% (WI158) + Government percentage tax 3% (code to confirm)",
    );
  });
});

describe("customerWithholdingChipLabel", () => {
  it("null → not set; [] → none; never 'No withholding' while picks are non-empty", () => {
    expect(customerWithholdingChipLabel(null)).toBe("Withholding: not set");
    expect(customerWithholdingChipLabel([])).toBe("Withholding: none");
    const label = customerWithholdingChipLabel([snap("GOODS_1"), snap("SERVICES_2")]);
    expect(label).toContain("Goods 1%");
    expect(label).toContain("Services 2%");
    expect(label).not.toMatch(/No withholding/i);
  });
});
