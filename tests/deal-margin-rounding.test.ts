// F23 (Mac run Block 9, S80): dealMargin truncated its percent with
// plain BigInt division, so Monthly profit showed 24.30% where the
// quotes list (which rounds via divRound) showed 24.31% for the same
// deal. The percent now rounds half away from zero, like quotes.
import { describe, expect, it } from "vitest";
import { dealMargin } from "@/lib/services/profit";

describe("dealMargin percent rounding (F23)", () => {
  it("rounds 24.3077% to 24.31, matching the quotes list", () => {
    const r = dealMargin("65000.00", "49200.00");
    expect(r.margin).toBe("15800.00");
    expect(r.marginPct).toBe("24.31");
  });

  it("rounds a negative margin percent away from zero", () => {
    // margin -100 on 3000 = -3.3333% -> -3.33; and -2.345% rounds to -2.35.
    expect(dealMargin("3000.00", "3100.00").marginPct).toBe("-3.33");
    expect(dealMargin("20000.00", "20469.00").marginPct).toBe("-2.35");
  });

  it("keeps exact percents and the zero-price guard", () => {
    expect(dealMargin("10000.00", "7500.00").marginPct).toBe("25.00");
    expect(dealMargin("0.00", "0.00").marginPct).toBeNull();
  });

  it("shows no percent when the supplier cost was never set (D8)", () => {
    // ₱0.00 cost = "not set" (supplierCostMissing): the peso margin stays
    // the full price, but a 100% percent would print the placeholder as
    // fact on the Monthly profit page and its CSV.
    const r = dealMargin("5450.00", "0.00");
    expect(r.margin).toBe("5450.00");
    expect(r.marginPct).toBeNull();
  });
});
