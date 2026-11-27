// P-A (finding 1028): the Operations CSV carries the same bridge lines as
// the page — the walk from the own-company recorded profit to the official
// net — and every pre-existing line stays byte-identical. The DB-backed
// derivation of the bridge values is covered in
// tests/db/reconciliation.db.test.ts; this pins the CSV shape only.
import { describe, expect, it } from "vitest";
import { operationalProfitToCsv, type OperationalProfit } from "@/lib/services/reconciliation";

// The run-87 seed figures (D2's SQL bridge) as a fixed fixture:
// 976151.50 - 912951.50 + 1226250.00 = 1289450.00.
const report: OperationalProfit = {
  month: "2026-11",
  rows: [
    {
      businessId: null,
      label: "HACIEN",
      sales: "2602401.50",
      supplierCosts: "1626250.00",
      expenses: "0.00",
      profit: "976151.50",
      orderCount: 15,
    },
  ],
  combined: {
    businessId: null,
    label: "All businesses",
    sales: "2602401.50",
    supplierCosts: "1626250.00",
    expenses: "0.00",
    profit: "976151.50",
    orderCount: 15,
  },
  officialBilledRevenue: "1689450.00",
  officialNet: "1289450.00",
  bridge: {
    recordedSales: "2602401.50",
    recordedProfit: "976151.50",
    unbilled: "912951.50",
    recordedCosts: "1626250.00",
    supplierBills: "400000.00",
    costsVsBills: "1226250.00",
  },
};

describe("operational profit CSV bridge (finding 1028)", () => {
  it("prints the bridge components after the official totals", () => {
    const csv = operationalProfitToCsv(report);
    expect(csv).toContain("Bridge - recorded profit (own company),976151.50\n");
    expect(csv).toContain("Bridge - less recorded sales not in official billed revenue,912951.50\n");
    expect(csv).toContain("Bridge - add supplier costs above supplier bills recorded,1226250.00\n");
    expect(csv).toContain('"Bridge - supplier bills recorded (Books, HACIEN only)",400000.00\n');
  });

  it("keeps the pre-existing lines byte-identical", () => {
    const csv = operationalProfitToCsv(report);
    expect(csv.startsWith("Operational profit — all recorded orders (not the official Books figure),2026-11\n")).toBe(true);
    expect(csv).toContain("Business,Orders,Recorded sales,Supplier costs,Expenses,Profit\n");
    expect(csv).toContain("HACIEN,15,2602401.50,1626250.00,0.00,976151.50\n");
    expect(csv).toContain('"Official billed revenue (Books, HACIEN only)",1689450.00\n');
    expect(csv).toContain('"Official net profit (Books, HACIEN only)",1289450.00\n');
  });

  it("the bridge closes: recorded - unbilled + costs-over-bills = official net", () => {
    const cents = (s: string) => Math.round(Number(s) * 100);
    expect(cents(report.bridge.recordedProfit) - cents(report.bridge.unbilled) + cents(report.bridge.costsVsBills)).toBe(
      cents(report.officialNet),
    );
  });
});
