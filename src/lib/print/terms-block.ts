// Modular 7-point terms block for Quote and SO prints.
// Source: /workspace/hacien/legal/quote-so-terms-block-v3.md (Terms of Sale v3),
// as approved by the lawyer & CPA (sign-off pasted 2026-11-06): the block
// stays printed (QR-only was rejected) but follows the quote — point 2
// prints only the payment sentence matching the quote's terms, point 3
// takes the per-quote lead time, point 5 has goods (5A) and services-only
// (5B) variants, point 6 prints for business/government customers only,
// point 7 stays on every quote with "past their due date".
//
// Numbering: points keep their lawyer's numbers (1–7) even when one is
// omitted, so the printed numbers always match the Terms of Sale clauses.

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

/** The anti-fraud sentence that ends every Point 2 variant. */
const PAYMENT_ANTI_FRAUD =
  "Pay by bank transfer, check or cash, only to the account printed on this document.";

/**
 * Point 2 — payment. Prints ONLY the sentence matching the quote's payment
 * terms. Custom or empty terms fall back to the v3 combined text (the old
 * point 2), so the block never prints no payment sentence at all.
 * Needs owner check: no custom-terms wording was supplied by the lawyer.
 */
export function quoteSoTermsPoint2(paymentTerms?: string | null): string {
  const terms = (paymentTerms ?? "").trim();
  if (terms.startsWith("100% upfront")) {
    return `Payment: 100% payment upon order confirmation, before we place the supplier or license order. ${PAYMENT_ANTI_FRAUD}`;
  }
  if (terms.startsWith("50% down")) {
    return `Payment: 50% down payment upon order confirmation (before we place the supplier order), and 50% on delivery. ${PAYMENT_ANTI_FRAUD}`;
  }
  if (terms.startsWith("Net 30")) {
    return `Payment: Net 30 calendar days from delivery and invoice date (for approved corporate and government accounts). ${PAYMENT_ANTI_FRAUD}`;
  }
  return `Payment: 50% down payment when you order, 50% on delivery. Software and special orders: 100% before we order. 30-day terms apply only to approved corporate and government accounts. ${PAYMENT_ANTI_FRAUD}`;
}

/**
 * Point 3 — lead time, cancellation & returns. With a figure, the estimate
 * is in business days from order confirmation and receipt of the required
 * down payment, subject to supplier stock. Without a figure, the no-figure
 * variant prints.
 */
export function quoteSoTermsPoint3(leadTimeDays?: number | null): string {
  if (leadTimeDays != null) {
    return `Estimated lead time: ${leadTimeDays} business days from our order confirmation and receipt of required down payment, subject to supplier stock. Lead times are estimates, not fixed deadlines. Every item is ordered for you, so an order can't be cancelled once we place the supplier order, and we don't accept change-of-mind returns. Defective, damaged or wrong items are repaired, replaced or refunded as the law requires.`;
  }
  return `Lead times are estimates, not fixed deadlines, and are subject to supplier stock. Every item is ordered for you, so an order can't be cancelled once we place the supplier order, and we don't accept change-of-mind returns. Defective, damaged or wrong items are repaired, replaced or refunded as the law requires.`;
}

/** Point 4 — delivery inspection & problem reporting (physical delivery only). */
export const QUOTE_SO_TERMS_POINT_4 =
  "On delivery, note any missing boxes or visible damage on the Delivery Receipt. Report visible damage within 24 hours, and missing or wrong contents within 3 days, to sales@haciensolutions.com or Viber, with photos. Your legal rights for hidden defects are not affected.";

/**
 * Point 5 — warranty. Variant 5A for goods/mixed quotes, 5B for
 * services-only quotes. Both open with the override phrase so any custom
 * warranty notes written on the quotation prevail.
 */
export function quoteSoTermsPoint5(isServicesOnly?: boolean): string {
  if (isServicesOnly) {
    return "Unless specific warranty notes on this quotation state otherwise, services are performed in line with the agreed scope on this quotation; report any workmanship issue within 7 days of completion so we can inspect and remedy the affected work.";
  }
  return "Unless specific warranty notes on this quotation state otherwise, warranty is the manufacturer's or distributor's, and we handle the claim for you. If a hardware item is dead on arrival, report it within 7 days and return shipping is free.";
}

/** Point 6 — withholding tax (business/government customers only). */
export const QUOTE_SO_TERMS_POINT_6 =
  "If you withhold tax, tell us before paying and give us a signed BIR Form 2307 upon payment. Without it, the withheld amount stays unpaid.";

/** Point 7 — ownership, late payment & court venue (always prints). */
export const QUOTE_SO_TERMS_POINT_7 =
  "HACIEN keeps ownership of the goods until they are fully paid. Accounts unpaid past their due date are charged 24% interest a year, plus 25% attorney's fees if we must go to court. Any case is filed in the proper courts of Pasig City. Full Terms of Sale apply: haciensolutions.com/terms-of-sale.";

export type TermsBlockInput = {
  validityDays?: number | null;
  /** The quote's payment-terms string (one of the 3 Settings defaults, or custom). */
  paymentTerms?: string | null;
  /** Estimated lead time in business days. Null = no figure (no-figure variant). */
  leadTimeDays?: number | null;
  /** True when every line on the quote is a service (no goods lines). */
  isServicesOnly?: boolean;
  /** True when the customer is a private individual buying for personal use. */
  isIndividual?: boolean;
};

/**
 * Return the terms points as strings, each prefixed with its point number.
 * Points keep their numbers when one is omitted: point 4 is skipped on
 * services-only quotes (no physical delivery), point 6 is skipped for
 * private individuals — the remaining points are NOT renumbered.
 */
export function buildQuoteSoTermsPoints(input: TermsBlockInput = {}): string[] {
  const points: string[] = [
    `1. ${quoteSoTermsPoint1(input.validityDays)}`,
    `2. ${quoteSoTermsPoint2(input.paymentTerms)}`,
    `3. ${quoteSoTermsPoint3(input.leadTimeDays)}`,
  ];
  if (!input.isServicesOnly) {
    points.push(`4. ${QUOTE_SO_TERMS_POINT_4}`);
  }
  points.push(`5. ${quoteSoTermsPoint5(input.isServicesOnly)}`);
  if (!input.isIndividual) {
    points.push(`6. ${QUOTE_SO_TERMS_POINT_6}`);
  }
  points.push(`7. ${QUOTE_SO_TERMS_POINT_7}`);
  return points;
}

/**
 * Backwards-compatible wrapper: the default block for a validity-days-only
 * caller (no payment terms, no lead time, goods, business customer).
 * Kept for the print fallback and existing callers.
 */
export function getQuoteSoTermsPoints(validityDays?: number | null): string[] {
  return buildQuoteSoTermsPoints({ validityDays });
}

/** Default 7-point terms block for quotes using the standard 15-day validity or sales orders. */
export const QUOTE_SO_TERMS_BLOCK = getQuoteSoTermsPoints(DEFAULT_QUOTE_VALIDITY_DAYS);
