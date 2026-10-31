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
  customerWithholdingChipLabel,
  customerWithholdingHint,
  defaultWithholdingFor,
  lineWithholdingFromPicks,
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
});
