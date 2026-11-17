import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TotalsBox, type TotalsBoxData } from "@/components/docs/DocParts";

function totals(partial: Partial<TotalsBoxData>): TotalsBoxData {
  return {
    contractPrice: "3000.00",
    withholding: [],
    withholdingTotal: "0.00",
    netReceived: "3000.00",
    ...partial,
  };
}

describe("TotalsBox supplier cost row", () => {
  it("shows ₱0.00 (never −₱0.00) when the supplier cost is zero", () => {
    const html = renderToStaticMarkup(
      createElement(TotalsBox, {
        totals: totals({ supplierCost: "0.00", netMargin: "3000.00", netMarginPct: "100.00", supplierCostState: "none" }),
        showCosts: true,
      }),
    );
    expect(html).toContain("Supplier cost");
    expect(html).not.toContain("−₱0.00");
    expect(html).toContain("₱0.00");
  });

  it("keeps the minus sign for a real supplier cost", () => {
    const html = renderToStaticMarkup(
      createElement(TotalsBox, {
        totals: totals({ supplierCost: "45000.00", netMargin: "7000.00", netMarginPct: "13.46", supplierCostState: "full" }),
        showCosts: true,
      }),
    );
    expect(html).toContain("−₱45,000.00");
  });
});
