import { describe, expect, it } from "vitest";
import {
  QUOTE_ZERO_TOTAL_ERROR,
  quoteInputSchema,
  quoteInputSchemaForSave,
  quoteTotalIsPositive,
} from "@/lib/validation/quotes";
import { addDays, isoDate, manilaToday } from "@/lib/format";

function payload(items: { qty: string; unitPrice: string }[]) {
  const today = manilaToday();
  return {
    customerId: "cust_1",
    contactId: null,
    date: isoDate(today),
    validUntil: isoDate(addDays(today, 15)),
    terms: "",
    notes: "",
    items: items.map((i) => ({
      id: null,
      description: "Item",
      kind: "GOODS" as const,
      qty: i.qty,
      unit: "pc",
      unitPrice: i.unitPrice,
    })),
  };
}

function zeroTotalIssues(parsed: ReturnType<typeof quoteInputSchema.safeParse>) {
  if (parsed.success) return [];
  return parsed.error.issues.filter((i) => i.message === QUOTE_ZERO_TOTAL_ERROR);
}

describe("S-78 — ₱0 quote block (save schema)", () => {
  it("blocks a quote totaling exactly ₱0", () => {
    const parsed = quoteInputSchema.safeParse(payload([{ qty: "1", unitPrice: "0" }]));
    expect(parsed.success).toBe(false);
    expect(zeroTotalIssues(parsed)).toHaveLength(1);
    expect(zeroTotalIssues(parsed)[0]?.path).toEqual(["items"]);
  });

  it("blocks several lines that all total ₱0", () => {
    const parsed = quoteInputSchema.safeParse(
      payload([
        { qty: "3", unitPrice: "0" },
        { qty: "2", unitPrice: "0.00" },
      ]),
    );
    expect(parsed.success).toBe(false);
    expect(zeroTotalIssues(parsed)).toHaveLength(1);
  });

  it("blocks an empty-lines quote (total ₱0)", () => {
    const parsed = quoteInputSchema.safeParse(payload([]));
    expect(parsed.success).toBe(false);
  });

  it("blocks a negative price (total below ₱0)", () => {
    const parsed = quoteInputSchema.safeParse(payload([{ qty: "1", unitPrice: "-100" }]));
    expect(parsed.success).toBe(false);
  });

  it("allows a total of ₱0.01", () => {
    const parsed = quoteInputSchema.safeParse(payload([{ qty: "1", unitPrice: "0.01" }]));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("allows a normal positive total", () => {
    const parsed = quoteInputSchema.safeParse(payload([{ qty: "2", unitPrice: "1500.50" }]));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("blocks a ₱0 edit re-save through the unchanged-legacy save schema", () => {
    const today = manilaToday();
    const stored = { date: isoDate(today), validUntil: isoDate(addDays(today, 15)) };
    const parsed = quoteInputSchemaForSave(payload([{ qty: "1", unitPrice: "0" }]), stored).safeParse(
      payload([{ qty: "1", unitPrice: "0" }]),
    );
    expect(parsed.success).toBe(false);
    expect(zeroTotalIssues(parsed)).toHaveLength(1);
  });
});

describe("S-78 — stored-total guard (send paths)", () => {
  it("treats exactly ₱0 and negatives as not positive, ₱0.01 as positive", () => {
    expect(quoteTotalIsPositive("0.00")).toBe(false);
    expect(quoteTotalIsPositive("0")).toBe(false);
    expect(quoteTotalIsPositive("-100.00")).toBe(false);
    expect(quoteTotalIsPositive("0.01")).toBe(true);
    expect(quoteTotalIsPositive("540000.00")).toBe(true);
  });

  it("uses the exact error wording staff see", () => {
    expect(QUOTE_ZERO_TOTAL_ERROR).toBe("A quote total must be more than ₱0.");
  });
});
