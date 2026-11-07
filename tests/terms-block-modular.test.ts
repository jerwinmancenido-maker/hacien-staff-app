// Modular quote/SO terms block (lawyer & CPA sign-off 2026-11-06).
// Point 2 follows the quote's payment terms, point 3 the per-quote lead
// time, point 5 the goods/services variant, point 6 only for business
// customers, point 7 always with "past their due date" + the terms-of-sale
// line. Points keep their numbers when one is omitted.

import { describe, expect, it } from "vitest";
import {
  buildQuoteSoTermsPoints,
  getQuoteSoTermsPoints,
  quoteSoTermsPoint2,
  quoteSoTermsPoint3,
  quoteSoTermsPoint5,
} from "@/lib/print/terms-block";

describe("modular terms block", () => {
  it("default block is 7 points with the v3 fallback payment sentence", () => {
    const points = buildQuoteSoTermsPoints({});
    expect(points).toHaveLength(7);
    expect(points[0]).toContain("1. This quotation is valid for 15 days unless the quote states otherwise.");
    expect(points[1]).toContain("2. Payment: 50% down payment when you order, 50% on delivery.");
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
    // Custom or empty terms fall back to the v3 combined text (Needs owner check).
    expect(quoteSoTermsPoint2("Custom terms here")).toContain("50% down payment when you order, 50% on delivery.");
    expect(quoteSoTermsPoint2("Custom terms here")).toContain("Pay by bank transfer, check or cash, only to the account printed on this document.");
    expect(quoteSoTermsPoint2(null)).toContain("50% down payment when you order, 50% on delivery.");
    expect(quoteSoTermsPoint2("")).toContain("50% down payment when you order, 50% on delivery.");
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
