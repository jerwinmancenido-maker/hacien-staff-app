import { describe, expect, it } from "vitest";
import { customerMoneyTotals } from "@/lib/print/views";

describe("customerMoneyTotals", () => {
  it("shows Subtotal + Total without WHT when withholding is zero", () => {
    expect(
      customerMoneyTotals({
        contractPrice: "1000.00",
        withholdingTotal: "0.00",
        netReceived: "1000.00",
        withholding: [],
      }),
    ).toEqual([
      { label: "Subtotal", amount: "1000.00" },
      { label: "Total", amount: "1000.00", emphasize: true },
    ]);
  });

  it("even with withholdingTotal > 0, only Subtotal + Total (no Less / Net)", () => {
    const lines = customerMoneyTotals({
      contractPrice: "520000.00",
      withholdingTotal: "20800.00",
      netReceived: "499200.00",
      withholding: [
        { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS", rate: "0.0100", atcCode: null },
        { code: "GOV_PT_3", label: "Gov PT 3%", lineKind: "GOV_PT", rate: "0.0300", atcCode: null },
      ],
    });
    expect(lines).toEqual([
      { label: "Subtotal", amount: "520000.00" },
      { label: "Total", amount: "520000.00", emphasize: true },
    ]);
    expect(lines.map((l) => l.label).join(" ")).not.toMatch(/Less|Net|withholding|WHT/i);
  });
});
