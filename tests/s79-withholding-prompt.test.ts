import { describe, expect, it } from "vitest";
import { quoteMarkSentGate, quoteSaveGate } from "@/lib/quotes/approval";
import {
  isWithholdingNotSet,
  WITHHOLDING_NONE_CONFIRM_PICK,
  WITHHOLDING_NONE_CONFIRM_TITLE,
  WITHHOLDING_NONE_CONFIRM_YES,
} from "@/lib/quotes/withholding-defaults";
import {
  QUOTE_ZERO_TOTAL_ERROR,
  quoteInputSchemaForSave,
} from "@/lib/validation/quotes";
import { addDays, isoDate, manilaToday } from "@/lib/format";

// S-79: the "No withholding on this quote?" prompt also appears on Save draft
// (and Submit for approval, which is the same save action — a new quote is
// created PENDING and an edit save resets approval to PENDING). The prompt is
// client-side UI in QuoteEditor, so the repo's unit tests cover the shared
// decision logic it runs on: the save gate, the exact prompt copy, and the
// trigger condition — all identical to the Mark-as-sent path. The dialog
// open/cancel/confirm wiring itself needs a staging look (see PR).

describe("S-79 — save gate mirrors the Mark-as-sent gate order", () => {
  it("cost warning wins over the withholding question, as on Mark as sent", () => {
    expect(
      quoteSaveGate({ withholdingUnset: true, supplierCostMissing: true }),
    ).toBe("cost-warning");
    expect(
      quoteMarkSentGate({
        approved: true,
        withholdingUnset: true,
        supplierCostMissing: true,
      }),
    ).toBe("cost-warning");
  });

  it("asks the withholding question when no pick is set and no cost is missing", () => {
    expect(
      quoteSaveGate({ withholdingUnset: true, supplierCostMissing: false }),
    ).toBe("withholding-unset");
  });

  it("saves straight through when withholding is picked (rates or explicit none)", () => {
    expect(
      quoteSaveGate({ withholdingUnset: false, supplierCostMissing: false }),
    ).toBe("save");
  });
});

describe("S-79 — same trigger condition as Mark as sent", () => {
  it("fires only when the pick is null (not set); [] and picked rates do not fire", () => {
    expect(isWithholdingNotSet(null)).toBe(true);
    expect(isWithholdingNotSet(undefined)).toBe(true);
    expect(isWithholdingNotSet([])).toBe(false);
    expect(isWithholdingNotSet(["GOV_GOODS_1"])).toBe(false);
    // Mark as sent uses the same expression (withholdingUnset: pick == null).
    expect(
      quoteMarkSentGate({
        approved: true,
        withholdingUnset: isWithholdingNotSet(null),
        supplierCostMissing: false,
      }),
    ).toBe("withholding-unset");
    expect(
      quoteMarkSentGate({
        approved: true,
        withholdingUnset: isWithholdingNotSet([]),
        supplierCostMissing: false,
      }),
    ).toBe("send");
  });
});

describe("S-79 — same prompt copy as Mark as sent", () => {
  it("uses the exact Mark-as-sent title and choice labels", () => {
    expect(WITHHOLDING_NONE_CONFIRM_TITLE).toBe("No withholding on this quote?");
    expect(WITHHOLDING_NONE_CONFIRM_YES).toBe("Yes, none");
    expect(WITHHOLDING_NONE_CONFIRM_PICK).toBe("Pick rates");
  });
});

describe("S-79 — prompt does not bypass the S-78 ₱0 block", () => {
  it("a ₱0 quote still fails the save schema even with explicit none confirmed", () => {
    const today = manilaToday();
    const stored = { date: isoDate(today), validUntil: isoDate(addDays(today, 15)) };
    const payload = {
      customerId: "cust_1",
      contactId: null,
      date: isoDate(today),
      validUntil: isoDate(addDays(today, 15)),
      terms: "",
      notes: "",
      withholdingCodes: [] as string[],
      withholdingExplicitNone: true,
      items: [
        {
          id: null,
          description: "Item",
          kind: "GOODS" as const,
          qty: "1",
          unit: "pc",
          unitPrice: "0",
        },
      ],
    };
    const parsed = quoteInputSchemaForSave(payload, stored).safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.filter((i) => i.message === QUOTE_ZERO_TOTAL_ERROR),
      ).toHaveLength(1);
    }
  });
});
