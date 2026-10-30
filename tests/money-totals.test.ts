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
      { label: "Subtotal", amount: "50.00" },
      { label: "Amount", amount: "50.00", emphasize: true },
    ]);
  });
});
