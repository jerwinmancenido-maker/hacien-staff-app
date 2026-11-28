// ERP adoption item 7: the list progress percentages must be true numbers —
// null (no bar) when there is no real base, exact otherwise, never clamped
// in the value itself (only the bar fill clamps, in the component).

import { describe, expect, it } from "vitest";
import { percentFill, percentLabel, percentOf } from "@/lib/progress";

describe("percentOf", () => {
  it("is null when the denominator is zero or negative — no fake 0 bars", () => {
    expect(percentOf("0.00", "0.00")).toBeNull();
    expect(percentOf("10.00", "0.00")).toBeNull();
    expect(percentOf("10.00", "-5.00")).toBeNull();
  });

  it("is a true 0 when the base exists and nothing is done yet", () => {
    expect(percentOf("0.00", "100.00")).toBe(0);
  });

  it("computes exact percentages with 2 decimals", () => {
    expect(percentOf("1.00", "3.00")).toBe(33.33);
    expect(percentOf("2.00", "3.00")).toBe(66.67);
    expect(percentOf("10.00", "11.00")).toBe(90.91);
    expect(percentOf("400000.00", "480000.00")).toBe(83.33);
    expect(percentOf("17170.00", "400000.00")).toBe(4.29);
    expect(percentOf("600000.00", "600000.00")).toBe(100);
  });

  it("keeps over-100 values true instead of clamping them away", () => {
    // A PO billed ₱13,500 against a ₱13,000 subtotal is 103.85% billed.
    expect(percentOf("13500.00", "13000.00")).toBe(103.85);
  });

  it("rounds half up at the second decimal", () => {
    expect(percentOf("1.00", "8.00")).toBe(12.5);
    expect(percentOf("3.00", "16.00")).toBe(18.75);
    expect(percentOf("1.00", "16.00")).toBe(6.25);
  });

  it("guards a negative numerator to 0", () => {
    expect(percentOf("-1.00", "100.00")).toBe(0);
  });
});

describe("percentLabel / percentFill", () => {
  it("labels whole percents, over-100 included", () => {
    expect(percentLabel(83.33)).toBe("83%");
    expect(percentLabel(90.91)).toBe("91%");
    expect(percentLabel(103.85)).toBe("104%");
    expect(percentLabel(0)).toBe("0%");
    expect(percentLabel(100)).toBe("100%");
  });

  it("fill clamps to the 0–100 track while the label stays true", () => {
    expect(percentFill(103.85)).toBe(100);
    expect(percentFill(83.33)).toBe(83.33);
    expect(percentFill(-2)).toBe(0);
  });
});
