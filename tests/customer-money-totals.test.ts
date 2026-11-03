import { describe, expect, it } from "vitest";
import { customerMoneyTotals, lessEwtLabel } from "@/lib/print/views";

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

  it("keeps Total as contract price and shows less EWT + Net amount due when WH > 0", () => {
    const lines = customerMoneyTotals({
      contractPrice: "520000.00",
      withholdingTotal: "5200.00",
      netReceived: "514800.00",
      withholding: [
        { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS", rate: "0.0100", atcCode: null },
      ],
    });
    expect(lines).toEqual([
      { label: "Subtotal", amount: "520000.00" },
      { label: "Total", amount: "520000.00", emphasize: true },
      { label: "less 1% EWT", amount: "5200.00" },
      { label: "Net amount due", amount: "514800.00" },
    ]);
    // Gross Total unchanged; net is separate and clearly labelled.
    expect(lines.find((l) => l.label === "Total")?.amount).toBe("520000.00");
    expect(Number(lines.find((l) => l.label === "Total")!.amount) - Number(lines.find((l) => l.label === "less 1% EWT")!.amount)).toBe(
      Number(lines.find((l) => l.label === "Net amount due")!.amount),
    );
  });

  it("mixed rates label as less EWT (no fake combined %)", () => {
    const lines = customerMoneyTotals({
      contractPrice: "520000.00",
      withholdingTotal: "20800.00",
      netReceived: "499200.00",
      withholding: [
        { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS", rate: "0.0100", atcCode: null },
        { code: "GOV_PT_3", label: "Gov PT 3%", lineKind: "GOV_PT", rate: "0.0300", atcCode: null },
      ],
    });
    expect(lines.map((l) => l.label)).toEqual(["Subtotal", "Total", "less EWT", "Net amount due"]);
    expect(lines.find((l) => l.label === "Total")?.amount).toBe("520000.00");
    expect(lines.find((l) => l.label === "less EWT")?.amount).toBe("20800.00");
    expect(lines.find((l) => l.label === "Net amount due")?.amount).toBe("499200.00");
  });
});

describe("lessEwtLabel", () => {
  it("formats a single rate as less N% EWT", () => {
    expect(
      lessEwtLabel({
        withholding: [{ rate: "0.0100" }],
        withholdingTotal: "100.00",
        baseAmount: "10000.00",
      }),
    ).toBe("less 1% EWT");
  });
});
