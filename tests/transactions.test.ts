// Transactions tab helpers: exact money sums and margin %.

import { describe, expect, it } from "vitest";
import { __test } from "@/lib/services/transactions";

const { sumMoney, pctOf } = __test;

describe("transaction totals", () => {
  it("adds money exactly (no float drift)", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["520000.00", "20000.00", "0.01"])).toBe("540000.01");
    expect(sumMoney([])).toBe("0.00");
    expect(sumMoney([null, undefined, "5"])).toBe("5.00");
    expect(sumMoney([{ toFixed: () => "12.34" }, "0.66"])).toBe("13.00");
    expect(sumMoney(["-10.00", "2.50"])).toBe("-7.50");
  });

  it("margin % of the total, 2 decimals, half away from zero", () => {
    expect(pctOf("70000.00", "540000.00")).toBe("12.96");
    expect(pctOf("1.00", "3.00")).toBe("33.33");
    expect(pctOf("2.00", "3.00")).toBe("66.67");
    expect(pctOf("-1.00", "8.00")).toBe("-12.50");
    expect(pctOf("5.00", "0.00")).toBe("0.00");
  });
});
