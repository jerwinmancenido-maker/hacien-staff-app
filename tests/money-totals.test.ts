import { describe, expect, it } from "vitest";
import { moneyTotals } from "@/lib/print/views";

describe("moneyTotals", () => {
  it("ignores extra when computing Total (Total amount stays subtotal)", () => {
    const lines = moneyTotals("100.00", [{ label: "EWT", amount: "10.00" }, { label: "Other", amount: "999.00" }]);
    expect(lines).toEqual([
      { label: "Subtotal", amount: "100.00" },
      { label: "EWT", amount: "10.00" },
      { label: "Other", amount: "999.00" },
      { label: "Total", amount: "100.00", emphasize: true },
    ]);
    expect(lines.at(-1)?.amount).toBe("100.00");
  });

  it("uses an optional total label without changing the amount", () => {
    expect(moneyTotals("50.00", [], "Amount")).toEqual([
      { label: "Amount", amount: "50.00", emphasize: true },
    ]);
  });

  it("stands alone with no Subtotal row when there are no mid-lines (owner 2026-11-09)", () => {
    expect(moneyTotals("100.00")).toEqual([{ label: "Total", amount: "100.00", emphasize: true }]);
  });
});
