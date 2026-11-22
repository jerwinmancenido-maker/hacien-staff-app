// Modular quote/SO terms block (lawyer & CPA sign-off 2026-11-06).
// Point 2 follows the quote's payment terms, point 3 the per-quote lead
// time, point 5 the goods/services variant, point 6 only for business
// customers, point 7 always with "past their due date" + the terms-of-sale
// line. Points keep their numbers when one is omitted.

import { describe, expect, it } from "vitest";
import {
  buildQuoteSoTermsPoints,
  COD_POINT2_TEXT,
  findBlockedPaymentTerms,
  getQuoteSoTermsPoints,
  printedTermsLabel,
  quoteSoTermsPoint2,
  quoteSoTermsPoint3,
  quoteSoTermsPoint5,
  resolvePaymentTerm,
  sanitizePrintedNotes,
} from "@/lib/print/terms-block";

describe("modular terms block", () => {
  it("default block is 7 points; with no terms recorded Point 2 asserts no schedule", () => {
    const points = buildQuoteSoTermsPoints({});
    expect(points).toHaveLength(7);
    expect(points[0]).toContain("1. This quotation is valid for 15 days unless the quote states otherwise.");
    expect(points[1]).toBe("2. Payment: Pay by bank transfer, check or cash, only to the account printed on this document.");
    expect(points[2]).toContain("3. Lead times are estimates, not fixed deadlines, and are subject to supplier stock.");
    expect(points[3]).toContain("4. On delivery, note any missing boxes");
    expect(points[4]).toContain("Unless specific warranty notes on this quotation state otherwise, warranty is the manufacturer's or distributor's");
    expect(points[5]).toContain("6. If you withhold tax, tell us before paying and give us a signed BIR Form 2307 upon payment.");
    expect(points[6]).toContain("7. HACIEN keeps ownership of the goods until they are fully paid.");
    expect(points[6]).toContain("Accounts unpaid past their due date are charged 24% interest a year");
    expect(points[6]).toContain("Full Terms of Sale apply: haciensolutions.com/terms-of-sale");
  });

  it("point 2 prints only the sentence matching the quote's payment terms", () => {
    expect(quoteSoTermsPoint2("50% down, 50% on delivery")).toBe(
      "Payment: 50% down payment upon order confirmation (before we place the supplier order), and 50% on delivery. Pay by bank transfer, check or cash, only to the account printed on this document.",
    );
    expect(quoteSoTermsPoint2("100% upfront (software and special orders)")).toBe(
      "Payment: 100% payment upon order confirmation, before we place the supplier or license order. Pay by bank transfer, check or cash, only to the account printed on this document.",
    );
    expect(quoteSoTermsPoint2("Net 30 (approved accounts only)")).toBe(
      "Payment: Net 30 calendar days from delivery and invoice date (for approved corporate and government accounts). Pay by bank transfer, check or cash, only to the account printed on this document.",
    );
    // Custom terms print the quote's own text + the Option 3A anti-fraud
    // sentence (lawyer ruling 2026-11-23) \u2014 never the old 50/50 fallback.
    expect(quoteSoTermsPoint2("Custom terms here")).toBe(
      "Payment: Custom terms here. Pay by bank transfer, check or cash, only to the account printed on this document (or to our authorized representative against an official HACIEN Sales Invoice or Collection Receipt).",
    );
    expect(quoteSoTermsPoint2("Custom terms here")).not.toContain("50% down payment when you order");
    // A trailing period in the custom text is not doubled.
    expect(quoteSoTermsPoint2("30% on order, balance on delivery.")).toBe(
      "Payment: 30% on order, balance on delivery. Pay by bank transfer, check or cash, only to the account printed on this document (or to our authorized representative against an official HACIEN Sales Invoice or Collection Receipt).",
    );
    // No terms recorded: Point 2 still prints, anti-fraud sentence only.
    expect(quoteSoTermsPoint2(null)).toBe(
      "Payment: Pay by bank transfer, check or cash, only to the account printed on this document.",
    );
    expect(quoteSoTermsPoint2("")).toBe(quoteSoTermsPoint2(null));
    expect(quoteSoTermsPoint2(null)).not.toContain("50% down payment when you order");
    // No variant mentions another variant's terms.
    expect(quoteSoTermsPoint2("Net 30 (approved accounts only)")).not.toContain("50% down payment upon order confirmation");
    expect(quoteSoTermsPoint2("50% down, 50% on delivery")).not.toContain("Net 30 calendar days");
  });

  it("point 3 takes the lead time in business days, or the no-figure variant", () => {
    expect(quoteSoTermsPoint3(10)).toBe(
      "Estimated lead time: 10 business days from our order confirmation and receipt of required down payment, subject to supplier stock. Lead times are estimates, not fixed deadlines. Every item is ordered for you, so an order can't be cancelled once we place the supplier order, and we don't accept change-of-mind returns. Defective, damaged or wrong items are repaired, replaced or refunded as the law requires.",
    );
    expect(quoteSoTermsPoint3(1)).toContain("Estimated lead time: 1 business days");
    expect(quoteSoTermsPoint3(null)).toBe(
      "Lead times are estimates, not fixed deadlines, and are subject to supplier stock. Every item is ordered for you, so an order can't be cancelled once we place the supplier order, and we don't accept change-of-mind returns. Defective, damaged or wrong items are repaired, replaced or refunded as the law requires.",
    );
  });

  it("point 5 has goods (5A) and services-only (5B) variants", () => {
    expect(quoteSoTermsPoint5(false)).toContain("warranty is the manufacturer's or distributor's");
    expect(quoteSoTermsPoint5(false)).toContain("dead on arrival, report it within 7 days");
    expect(quoteSoTermsPoint5(true)).toContain("services are performed in line with the agreed scope");
    expect(quoteSoTermsPoint5(true)).toContain("report any workmanship issue within 7 days of completion");
    expect(quoteSoTermsPoint5(false)).toContain("Unless specific warranty notes on this quotation state otherwise");
    expect(quoteSoTermsPoint5(true)).toContain("Unless specific warranty notes on this quotation state otherwise");
  });

  it("services-only quotes skip point 4 and use 5B, keeping their numbers", () => {
    const points = buildQuoteSoTermsPoints({ isServicesOnly: true });
    expect(points).toHaveLength(6);
    expect(points.map((p) => p.split(".")[0])).toEqual(["1", "2", "3", "5", "6", "7"]);
    expect(points[3]).toContain("5. Unless specific warranty notes");
    expect(points[3]).toContain("services are performed in line with the agreed scope");
    expect(points.some((p) => p.startsWith("4."))).toBe(false);
  });

  it("private individuals skip point 6, keeping their numbers", () => {
    const points = buildQuoteSoTermsPoints({ isIndividual: true });
    expect(points).toHaveLength(6);
    expect(points.map((p) => p.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "7"]);
    expect(points.some((p) => p.startsWith("6."))).toBe(false);
    expect(points[5]).toContain("7. HACIEN keeps ownership");
  });

  it("services-only + individual quotes print 1, 2, 3, 5, 7", () => {
    const points = buildQuoteSoTermsPoints({ isServicesOnly: true, isIndividual: true });
    expect(points).toHaveLength(5);
    expect(points.map((p) => p.split(".")[0])).toEqual(["1", "2", "3", "5", "7"]);
  });

  it("a full quote input combines every variant", () => {
    const points = buildQuoteSoTermsPoints({
      validityDays: 30,
      paymentTerms: "Net 30 (approved accounts only)",
      leadTimeDays: 14,
      isServicesOnly: false,
      isIndividual: false,
    });
    expect(points).toHaveLength(7);
    expect(points[0]).toContain("1. This quotation is valid for 30 days.");
    expect(points[1]).toContain("2. Payment: Net 30 calendar days from delivery and invoice date");
    expect(points[2]).toContain("3. Estimated lead time: 14 business days");
  });

  it("the validity-days wrapper keeps the default block", () => {
    const points = getQuoteSoTermsPoints(7);
    expect(points).toHaveLength(7);
    expect(points[0]).toContain("1. This quotation is valid for 7 days.");
    expect(getQuoteSoTermsPoints(null)).toHaveLength(7);
  });
});

describe("COD structured term (lawyer ruling 2026-11-23, Option 1A + 3A)", () => {
  it("resolves every stored terms string into one structured kind", () => {
    expect(resolvePaymentTerm("COD")).toEqual({ kind: "COD", customText: null });
    expect(resolvePaymentTerm("cod")).toEqual({ kind: "COD", customText: null });
    expect(resolvePaymentTerm(" COD ")).toEqual({ kind: "COD", customText: null });
    expect(resolvePaymentTerm("100% upfront (software and special orders)").kind).toBe("UPFRONT");
    expect(resolvePaymentTerm("50% down, 50% on delivery").kind).toBe("FIFTY_FIFTY");
    expect(resolvePaymentTerm("Net 30 (approved accounts only)").kind).toBe("NET30");
    expect(resolvePaymentTerm("30% on order, 70% on acceptance")).toEqual({
      kind: "CUSTOM",
      customText: "30% on order, 70% on acceptance",
    });
    expect(resolvePaymentTerm(null).kind).toBe("NONE");
    expect(resolvePaymentTerm("").kind).toBe("NONE");
  });

  it("a COD quote's Point 2 is exactly the COD constant, with no 50/50 sentence anywhere", () => {
    expect(quoteSoTermsPoint2("COD")).toBe(COD_POINT2_TEXT);
    const points = buildQuoteSoTermsPoints({ paymentTerms: "COD" });
    expect(points).toHaveLength(7);
    expect(points[1]).toBe(`2. ${COD_POINT2_TEXT}`);
    const whole = points.join("\n");
    expect(whole).not.toContain("50% down payment when you order");
    expect(whole).not.toContain("50% down payment upon order confirmation");
    expect(whole).not.toContain("50% on delivery");
  });

  it("the printed Remarks label is generated from the term", () => {
    expect(printedTermsLabel("COD")).toBe("COD");
    expect(printedTermsLabel("cod")).toBe("COD");
    expect(printedTermsLabel("Net 30 (approved accounts only)")).toBe("Net 30 (approved accounts only)");
    expect(printedTermsLabel("50% down, 50% on delivery")).toBe("50% down, 50% on delivery");
    expect(printedTermsLabel(null)).toBeNull();
    expect(printedTermsLabel("")).toBeNull();
  });

  it("free-text notes cannot carry a payment term onto the print", () => {
    expect(findBlockedPaymentTerms("Ask for Net 30 terms")).toEqual(["Net <days>"]);
    expect(findBlockedPaymentTerms("50/50 agreed, down payment first, upfront rest, COD")).toEqual([
      "50/50",
      "down payment",
      "upfront",
      "COD",
    ]);
    expect(findBlockedPaymentTerms("Deliver to Gate 3 after 5 PM")).toEqual([]);
    expect(sanitizePrintedNotes("Deliver to Gate 3. Ask for Net 30 terms.")).toBe(
      "Deliver to Gate 3. Ask for terms.",
    );
    expect(sanitizePrintedNotes("COD")).toBeNull();
    expect(sanitizePrintedNotes("Payment 50/50 agreed")).toBe("Payment agreed");
    expect(sanitizePrintedNotes("down payment received, balance upfront")).toBe("received, balance");
    // Clean notes print byte-identical.
    expect(sanitizePrintedNotes("Deliver after 5 PM, call on arrival.")).toBe(
      "Deliver after 5 PM, call on arrival.",
    );
    expect(sanitizePrintedNotes(null)).toBeNull();
    expect(sanitizePrintedNotes("")).toBeNull();
  });
});
