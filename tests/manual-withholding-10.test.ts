import { describe, expect, it } from "vitest";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import {
  docTotals,
  sumWithholdingParts,
  withholdingBreakdownFromPicks,
} from "@/lib/quotes/calc";
import { customerMoneyTotals } from "@/lib/print/views";
import {
  WITHHOLDING_DEFAULT_ROWS,
  WITHHOLDING_HINT_NONE,
  WITHHOLDING_HINT_NOT_SET,
  customerWithholdingChipLabel,
  customerWithholdingHint,
  defaultWithholdingFor,
  lineWithholdingFromPicks,
  resolveCustomerSavedPick,
} from "@/lib/quotes/withholding-defaults";
import { WITHHOLDING_LABELS } from "@/lib/validation/companies";

function snap(code: keyof typeof WITHHOLDING_DEFAULT_ROWS): WithholdingSnapshot {
  const r = WITHHOLDING_DEFAULT_ROWS[code];
  return { code: r.code, label: r.label, lineKind: r.lineKind, rate: r.rate, atcCode: r.atcCode };
}

const mixedLines = [
  {
    kind: "GOODS" as const,
    total: "12505.00",
    supplierTotal: "0.00",
    margin: "12505.00",
    withholdingRate: "0.0400",
    withholdingAtc: null,
  },
  {
    kind: "SERVICES" as const,
    total: "7495.00",
    supplierTotal: "0.00",
    margin: "7495.00",
    withholdingRate: "0.0300",
    withholdingAtc: "WG010",
  },
];

describe("manual withholding picks (build brief 10)", () => {
  it("customerMoneyTotals never prints withholding / WHT / ATC / % / Less / Net", () => {
    const lines = customerMoneyTotals({
      contractPrice: "540000.00",
      withholdingTotal: "21400.00",
      netReceived: "518600.00",
      withholding: [snap("GOODS_1"), snap("GOV_PT_3")],
    });
    expect(lines).toEqual([
      { label: "Subtotal", amount: "540000.00" },
      { label: "Total", amount: "540000.00", emphasize: true },
    ]);
    const blob = JSON.stringify(lines).toLowerCase();
    for (const banned of ["withholding", "wht", "atc", "less", "net amount", "%", "wi158", "wg010"]) {
      expect(blob, banned).not.toContain(banned);
    }
  });

  it("combined rate hand math: goods 1%+3%, services 3%", () => {
    const picks = [snap("GOODS_1"), snap("GOV_PT_3")];
    expect(lineWithholdingFromPicks(picks, "GOODS").rate).toBe("0.0400");
    expect(lineWithholdingFromPicks(picks, "SERVICES").rate).toBe("0.0300");
    // Combined goods keeps the goods-specific ATC (not the rate number).
    expect(lineWithholdingFromPicks(picks, "GOODS").atc).toBe("WI158");
    expect(lineWithholdingFromPicks(picks, "SERVICES").atc).toBe("WG010");
    // 520000 × 0.04 + 20000 × 0.03 = 20800 + 600
    expect(520000 * 0.04 + 20000 * 0.03).toBe(21400);
  });

  it("defaultWithholdingFor never returns a non-zero rate", () => {
    for (const type of ["GOVERNMENT", "TOP_WITHHOLDING_AGENT", "NONE", null, "mystery"]) {
      for (const kind of ["GOODS", "SERVICES", "GOV_VAT"] as const) {
        expect(Number(defaultWithholdingFor(type, kind).rate)).toBe(0);
      }
    }
  });

  it("(a) mixed goods+services: whole-total rate is its own line; sum of parts === total", () => {
    const picks = [snap("GOODS_1"), snap("GOV_PT_3")];
    const parts = withholdingBreakdownFromPicks(mixedLines, picks);
    expect(parts.map((p) => p.code)).toEqual(["GOODS_1", "GOV_PT_3"]);
    expect(parts[0]!.lineKind).toBe("GOODS");
    expect(parts[1]!.lineKind).toBe("GOV_PT"); // whole-total — own line
    // Goods 1% of 12505 = 125.05; Gov 3% of 20000 = 600.00
    expect(parts[0]!.amount).toBe("125.05");
    expect(parts[1]!.amount).toBe("600.00");
    const sum = sumWithholdingParts(parts);
    expect(sum).toBe("725.05");
    const totals = docTotals(mixedLines, picks);
    expect(totals.withholdingTotal).toBe(sum);
    expect(sumWithholdingParts(totals.withholding)).toBe(totals.withholdingTotal);
    // Fails if breakdown only showed goods 1% + services 3% (=349.90) while total kept 725.05
    expect(sum).not.toBe("349.90");
  });

  it("(b) customer header chip and quote hint show the same saved pick; never 'No withholding' while WH applies", () => {
    const picks = [snap("GOODS_1"), snap("GOV_PT_3")];
    const header = customerWithholdingChipLabel(picks);
    const hint = customerWithholdingHint(picks);
    // Same saved pick content (hint adds the "Withholding: " prefix).
    expect(hint).toBe(`Withholding: ${header}`);
    expect(header.toLowerCase()).not.toContain("no withholding");
    expect(hint.toLowerCase()).not.toContain("no withholding");
    // Type label "No withholding" must not be used as the pick signal when rates are picked.
    expect(WITHHOLDING_LABELS.NONE).toBe("No withholding");
    expect(header).not.toBe(WITHHOLDING_LABELS.NONE);
    expect(customerWithholdingChipLabel([])).toBe("Withholding: none");
    expect(customerWithholdingHint([])).toBe(WITHHOLDING_HINT_NONE);
  });

  it("quote hint follows the quote pick, not the customer's saved pick", () => {
    // Customer still has Goods 1% + Gov 3% saved; quote pick was cleared → not set.
    const customerSaved = [snap("GOODS_1"), snap("GOV_PT_3")];
    expect(customerWithholdingHint(customerSaved)).toContain("Goods 1%");
    const quotePickCleared: WithholdingSnapshot[] | null = null;
    expect(customerWithholdingHint(quotePickCleared)).toBe(WITHHOLDING_HINT_NOT_SET);
    expect(customerWithholdingHint([])).toBe(WITHHOLDING_HINT_NONE);
  });

  it("internal margin ignores WH; cash after WH = contract − WH (seed 535k / 450k / 21,250)", () => {
    const picks = [snap("GOODS_1"), snap("GOV_PT_3")];
    const lines = [
      {
        kind: "GOODS" as const,
        total: "520000.00",
        supplierTotal: "450000.00",
        margin: "70000.00",
        withholdingRate: "0.0400",
        withholdingAtc: "WI158",
      },
      {
        kind: "SERVICES" as const,
        total: "15000.00",
        supplierTotal: "0.00",
        margin: "15000.00",
        withholdingRate: "0.0300",
        withholdingAtc: "WG010",
      },
    ];
    const t = docTotals(lines, picks);
    expect(t.contractPrice).toBe("535000.00");
    expect(t.supplierCost).toBe("450000.00");
    expect(t.withholdingTotal).toBe("21250.00");
    // Margin = 535000 − 450000 = 85000 (15.89%) — WH must not reduce it.
    expect(t.netMargin).toBe("85000.00");
    expect(t.netMarginPct).toBe("15.89");
    // Cash we receive after withholding = 535000 − 21250.
    expect(t.netReceived).toBe("513750.00");
    // Old wrong math would have been 513750 − 450000 = 63750.
    expect(t.netMargin).not.toBe("63750.00");
  });

  it("customer type No saves explicit none []", () => {
    expect(resolveCustomerSavedPick("NONE", ["GOODS_1", "GOV_PT_3"])).toEqual([]);
    expect(resolveCustomerSavedPick("NONE", null)).toEqual([]);
    expect(resolveCustomerSavedPick("GOVERNMENT", ["GOODS_1"])).toEqual(["GOODS_1"]);
    expect(resolveCustomerSavedPick("GOVERNMENT", null)).toBeNull();
    expect(resolveCustomerSavedPick("TOP_WITHHOLDING_AGENT", [])).toEqual([]);
  });
});
