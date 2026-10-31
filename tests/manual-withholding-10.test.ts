import { describe, expect, it } from "vitest";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import { customerMoneyTotals } from "@/lib/print/views";
import {
  WITHHOLDING_DEFAULT_ROWS,
  defaultWithholdingFor,
  lineWithholdingFromPicks,
} from "@/lib/quotes/withholding-defaults";

function snap(code: keyof typeof WITHHOLDING_DEFAULT_ROWS): WithholdingSnapshot {
  const r = WITHHOLDING_DEFAULT_ROWS[code];
  return { code: r.code, label: r.label, lineKind: r.lineKind, rate: r.rate, atcCode: r.atcCode };
}

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
});
