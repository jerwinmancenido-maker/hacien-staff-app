// S-53: monthly net profit + margin by deal. The DB query itself is not
// covered locally (no MySQL in this VM); the pure math and the CSV shape are.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dealMargin, profitMonth, profitToCsv, type MonthlyProfit } from "@/lib/services/profit";

const src = (p: string) => readFileSync(p, "utf8");

describe("S-53 deal margin math", () => {
  it("computes margin and margin %", () => {
    expect(dealMargin("100000.00", "70000.00")).toEqual({ margin: "30000.00", marginPct: "30.00" });
    expect(dealMargin("50000.00", "60000.00")).toEqual({ margin: "-10000.00", marginPct: "-20.00" });
  });

  it("leaves margin % blank on a ₱0 contract price instead of dividing by zero", () => {
    expect(dealMargin("0.00", "1000.00")).toEqual({ margin: "-1000.00", marginPct: null });
  });

  it("keeps only valid YYYY-MM months, defaulting to the current month", () => {
    expect(profitMonth("2026-11")).toBe("2026-11");
    expect(profitMonth("2026-13")).toMatch(/^\d{4}-\d{2}$/);
    expect(profitMonth("november")).toMatch(/^\d{4}-\d{2}$/);
    expect(profitMonth(null)).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("S-53 profit CSV", () => {
  it("lists the summary then one row per deal", () => {
    const report: MonthlyProfit = {
      month: "2026-11",
      revenue: "100000.00",
      supplierBills: "60000.00",
      expenses: "10000.00",
      net: "30000.00",
      deals: [{ number: "SO-2026-0001", date: "2026-11-04", contractPrice: "100000.00", supplierCost: "70000.00", margin: "30000.00", marginPct: "30.00" }],
    };
    const csv = profitToCsv(report);
    expect(csv).toContain("Net profit,30000.00");
    expect(csv).toContain("SO-2026-0001,2026-11-04,100000.00,70000.00,30000.00,30.00");
  });
});

describe("S-53 profit page wiring", () => {
  it("page states its definitions and links the aging pages", () => {
    const page = src("src/app/(app)/books/profit/page.tsx");
    expect(page).toContain("Management view, not a BIR book");
    expect(page).toContain("/billing/aging");
    expect(page).toContain("/payables/aging");
    expect(page).toContain("Export CSV");
    expect(page).toContain("Margin by deal");
  });

  it("nav and books home link the profit page", () => {
    expect(src("src/components/books/BooksNav.tsx")).toContain('"/books/profit"');
    expect(src("src/app/(app)/books/page.tsx")).toContain('"/books/profit"');
  });
});
