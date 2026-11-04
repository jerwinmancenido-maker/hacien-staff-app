import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMoneyInput } from "@/lib/format";
import { toScaled } from "@/lib/quotes/calc";

// S-72: not a bug — the activity log was right (₱25,500.50 × 3 = ₱76,501.50).
// Small fix: show prices with commas in the price box so typos are easier
// to spot. The stored value keeps commas, and money parsing + validation
// both strip commas before checking, so totals do not change.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-72 price boxes show commas", () => {
  it("groups the integer part, keeps the fraction exactly as typed", () => {
    expect(formatMoneyInput("25500.50")).toBe("25,500.50");
    expect(formatMoneyInput("76501.50")).toBe("76,501.50");
    expect(formatMoneyInput("1000")).toBe("1,000");
    expect(formatMoneyInput("1000000")).toBe("1,000,000");
    expect(formatMoneyInput("25,500.50")).toBe("25,500.50");
    expect(formatMoneyInput("25500.")).toBe("25,500.");
    expect(formatMoneyInput("25500.5")).toBe("25,500.5");
    expect(formatMoneyInput("")).toBe("");
    expect(formatMoneyInput("-25500.50")).toBe("-25,500.50");
  });

  it("leaves invalid input unchanged for validation to report", () => {
    expect(formatMoneyInput("abc")).toBe("abc");
    expect(formatMoneyInput("12.34.56")).toBe("12.34.56");
  });

  it("a comma-formatted price still computes the same total", () => {
    expect(toScaled(formatMoneyInput("25500.50"), 2)).toBe(toScaled("25500.50", 2));
    expect(toScaled(formatMoneyInput("25500.50"), 2) * 3n).toBe(7650150n);
  });

  it("line price and cost boxes use the helper in every editor", () => {
    const files = [
      "src/components/docs/QuoteEditor.tsx",
      "src/components/docs/DocumentEditor.tsx",
      "src/components/purchasing/PoEditor.tsx",
      "src/components/purchasing/BillForm.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).toContain("formatMoneyInput");
    }
    expect(read("src/components/docs/QuoteEditor.tsx")).toContain("{ unitPrice: formatMoneyInput(ev.target.value) }");
    expect(read("src/components/docs/QuoteEditor.tsx")).toContain("{ supplierUnitCost: formatMoneyInput(ev.target.value) }");
    expect(read("src/components/docs/DocumentEditor.tsx")).toContain("{ unitPrice: formatMoneyInput(ev.target.value) }");
    expect(read("src/components/purchasing/PoEditor.tsx")).toContain("{ unitCost: formatMoneyInput(ev.target.value) }");
    expect(read("src/components/purchasing/BillForm.tsx")).toContain("{ unitPrice: formatMoneyInput(ev.target.value) }");
    // Qty boxes are untouched — only money boxes are grouped.
    expect(read("src/components/docs/QuoteEditor.tsx")).toContain("{ qty: ev.target.value }");
  });
});
