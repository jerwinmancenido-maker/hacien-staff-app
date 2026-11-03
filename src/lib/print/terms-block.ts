// Settled 7-point terms block for Quote and SO prints.
// Source: /workspace/hacien/legal/quote-so-terms-block-v3.md (Terms of Sale v3).

export const TERMS_AND_CONDITIONS_HEADING = "TERMS AND CONDITIONS" as const;

export const DEFAULT_QUOTE_VALIDITY_DAYS = 15;

/**
 * Builds Point 1's validity sentence:
 * - If default (15 days or null/undefined): "This quotation is valid for 15 days unless the quote states otherwise."
 * - If custom N days: "This quotation is valid for N days."
 */
export function quoteValiditySentence(validityDays?: number | null): string {
  if (validityDays == null || validityDays === DEFAULT_QUOTE_VALIDITY_DAYS) {
    return "This quotation is valid for 15 days unless the quote states otherwise.";
  }
  return `This quotation is valid for ${validityDays} days.`;
}

/**
 * Point 1 with the validity sentence substituted verbatim per legal specs.
 */
export function quoteSoTermsPoint1(validityDays?: number | null): string {
  const sentence = quoteValiditySentence(validityDays);
  return `${sentence} Prices are in PHP. HACIEN is NON-VAT registered. The delivery fee is quoted separately. Prices of imported items may change if the exchange rate moves before we order. If they do, we will send a revised quotation first.`;
}

/**
 * Static points 2 through 7 copied verbatim from lawyer-confirmed terms block.
 */
export const QUOTE_SO_TERMS_POINTS_2_TO_7 = [
  "Payment: 50% down payment when you order, 50% on delivery. Software and special orders: 100% before we order. 30-day terms apply only to approved corporate and government accounts. Pay by bank transfer, check or cash, only to the account printed on this document.",
  "Lead times are estimates. Every item is ordered for you, so an order can't be cancelled once we place the supplier order, and we don't accept change-of-mind returns. Defective, damaged or wrong items are repaired, replaced or refunded as the law requires.",
  "On delivery, note any missing boxes or visible damage on the Delivery Receipt. Report visible damage within 24 hours, and missing or wrong contents within 3 days, to sales@haciensolutions.com or Viber, with photos. Your legal rights for hidden defects are not affected.",
  "Warranty is the manufacturer's or distributor's, and we handle the claim for you. If an item is dead on arrival, report it within 7 days and return shipping is free.",
  "If you withhold tax, tell us before paying and give us a signed BIR Form 2307. Without it, the withheld amount stays unpaid.",
  "HACIEN keeps ownership of the goods until they are fully paid. Accounts unpaid after 30 days are charged 24% interest a year, plus 25% attorney's fees if we must go to court. Any case is filed in the proper courts of Pasig City.",
] as const;

/**
 * Return the 7 points as strings, each prefixed with its point number (1. to 7.).
 */
export function getQuoteSoTermsPoints(validityDays?: number | null): string[] {
  return [
    `1. ${quoteSoTermsPoint1(validityDays)}`,
    ...QUOTE_SO_TERMS_POINTS_2_TO_7.map((text, idx) => `${idx + 2}. ${text}`),
  ];
}

/** Default 7-point terms block for quotes using the standard 15-day validity or sales orders. */
export const QUOTE_SO_TERMS_BLOCK = getQuoteSoTermsPoints(DEFAULT_QUOTE_VALIDITY_DAYS);
