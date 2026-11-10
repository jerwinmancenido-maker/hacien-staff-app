// rescaleBreakdown (PR #188, Bugbot @f8c58dc): a billing edit rescales the
// STORED issue-time parts — it never recaptures the live SO mix.
import { describe, expect, it } from "vitest";
import { rescaleBreakdown } from "@/lib/services/billings";

const stored = [
  { rate: "0.0100", atcCode: "WC160", amount: "60.00" },
  { rate: "0.0200", atcCode: "WC140", amount: "40.00" },
];

describe("rescaleBreakdown", () => {
  it("doubles every part when the expected total doubles, keeping rates", () => {
    const out = rescaleBreakdown(stored, "100.00", "200.00") as typeof stored;
    expect(out.map((p) => p.rate)).toEqual(["0.0100", "0.0200"]);
    expect(out.map((p) => p.amount)).toEqual(["120.00", "80.00"]);
  });
  it("returns the stored parts unchanged when the total is unchanged", () => {
    expect(rescaleBreakdown(stored, "100.00", "100.00")).toEqual(stored);
  });
  it("puts rounding cents on the last part", () => {
    const out = rescaleBreakdown(stored, "100.00", "100.01") as typeof stored;
    const sum = out.reduce((a, p) => a + Number(p.amount), 0);
    expect(sum).toBeCloseTo(100.01, 2);
  });
  it("returns undefined when nothing usable is stored", () => {
    expect(rescaleBreakdown(null, "100.00", "200.00")).toBeUndefined();
    expect(rescaleBreakdown([], "100.00", "200.00")).toBeUndefined();
    expect(rescaleBreakdown("junk", "100.00", "200.00")).toBeUndefined();
  });
});
