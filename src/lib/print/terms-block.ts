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
//
// COD + custom terms (OpenBot lawyer ruling 2026-11-23; Jerwin approved the
// lawyer's recommendations the same day): "COD" is a first-class structured
// term — Point 2 prints the dedicated COD text (Option 1A) and the 50%
// down-payment sentence is fully suppressed; custom terms print the quote's
// own text plus the Option 3A anti-fraud sentence; the printed Remarks row
// is generated from the same structured term and free-text notes are
// stripped of unlinked payment-term words, so the two can never contradict.
// Locking the printed Terms of Sale as v3.1 still awaits Jerwin's separate
// retained-lawyer confirmation — do not bump the printed version line.

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

/** The anti-fraud sentence that ends every standard Point 2 variant. */
const PAYMENT_ANTI_FRAUD =
  "Pay by bank transfer, check or cash, only to the account printed on this document.";

/**
 * Option 3A anti-fraud sentence (lawyer ruling 2026-11-23): ends Point 2 on
 * custom-terms quotes — the v3 sentence plus the authorized-representative
 * clause, so the payment-destination safeguard is never dropped.
 */
const CUSTOM_TERMS_ANTI_FRAUD =
  "Pay by bank transfer, check or cash, only to the account printed on this document (or to our authorized representative against an official HACIEN Sales Invoice or Collection Receipt).";

/**
 * COD Point 2 — Option 1A, approved by Jerwin 2026-11-23 on the OpenBot
 * lawyer's recommendation. This constant is the ONLY place the COD wording
 * lives: Point 2 for a COD quote is exactly this text, and the 50%
 * down-payment sentence never prints alongside it. Locking the printed
 * Terms of Sale as v3.1 still awaits Jerwin's separate retained-lawyer
 * confirmation.
 */
export const COD_POINT2_TEXT =
  "Payment: 100% Cash on Delivery (COD) upon release of goods (checks clear before payment is final). Software and special orders: 100% before we order. Pay by cash or check payable to the name on this document only to our authorized delivery representative (against an official HACIEN Sales Invoice or Collection Receipt), or by bank transfer only to the account printed on this document.";

export type PaymentTermKind =
  | "UPFRONT"
  | "FIFTY_FIFTY"
  | "NET30"
  | "COD"
  | "CUSTOM"
  | "NONE";

export type ResolvedPaymentTerm = {
  kind: PaymentTermKind;
  /** The quote's own payment text (CUSTOM only; null otherwise). */
  customText: string | null;
};

/**
 * Resolve the stored payment-terms string into the ONE structured term that
 * drives both Point 2 and the printed Remarks row, so the two can never
 * disagree. The Settings defaults keep their v3 branches; "COD" (a
 * long-standing saved value on customers and quotes) is a first-class term;
 * any other non-empty string is the quote's own custom terms (Option 3A).
 */
export function resolvePaymentTerm(
  paymentTerms?: string | null,
): ResolvedPaymentTerm {
  const terms = (paymentTerms ?? "").trim();
  if (!terms) return { kind: "NONE", customText: null };
  if (/^cod$/i.test(terms)) return { kind: "COD", customText: null };
  if (terms.startsWith("100% upfront")) return { kind: "UPFRONT", customText: null };
  if (terms.startsWith("50% down")) return { kind: "FIFTY_FIFTY", customText: null };
  if (terms.startsWith("Net 30")) return { kind: "NET30", customText: null };
  return { kind: "CUSTOM", customText: terms };
}

/**
 * Point 2 — payment. Prints ONLY the sentence matching the quote's
 * structured payment term, and never omits Point 2: a COD quote prints the
 * dedicated COD text with the 50% sentence fully suppressed, custom terms
 * print the quote's own text plus the Option 3A anti-fraud sentence, and a
 * quote with no terms recorded prints the anti-fraud sentence alone (no
 * payment schedule is asserted for it).
 */
export function quoteSoTermsPoint2(paymentTerms?: string | null): string {
  const term = resolvePaymentTerm(paymentTerms);
  switch (term.kind) {
    case "UPFRONT":
      return `Payment: 100% payment upon order confirmation, before we place the supplier or license order. ${PAYMENT_ANTI_FRAUD}`;
    case "FIFTY_FIFTY":
      return `Payment: 50% down payment upon order confirmation (before we place the supplier order), and 50% on delivery. ${PAYMENT_ANTI_FRAUD}`;
    case "NET30":
      return `Payment: Net 30 calendar days from delivery and invoice date (for approved corporate and government accounts). ${PAYMENT_ANTI_FRAUD}`;
    case "COD":
      return COD_POINT2_TEXT;
    case "CUSTOM": {
      const text = (term.customText ?? "").replace(/\.\s*$/, "");
      return `Payment: ${text}. ${CUSTOM_TERMS_ANTI_FRAUD}`;
    }
    case "NONE":
      return `Payment: ${PAYMENT_ANTI_FRAUD}`;
  }
}

/**
 * The value printed on the document's "Remarks:" row, generated from the
 * structured term (ruling 2026-11-23): a COD quote's Remarks row is exactly
 * "COD"; every other term keeps its stored string verbatim; no terms
 * recorded returns null so the caller's own fallback applies.
 */
export function printedTermsLabel(paymentTerms?: string | null): string | null {
  if (resolvePaymentTerm(paymentTerms).kind === "COD") return "COD";
  return paymentTerms && paymentTerms.trim() ? paymentTerms : null;
}

/**
 * Payment-term phrases that must never appear in the free-text notes on a
 * printed document (lawyer ruling 2026-11-23): typed payment words could
 * override or contradict Point 2, which is the single source of truth.
 * "COD" is included — the only COD statement on a document is the
 * generated Remarks row from the structured term.
 */
const BLOCKED_NOTE_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "Net <days>", pattern: /\bnet\s*\d+\b/gi },
  { label: "50/50", pattern: /\b50\s*\/\s*50\b/g },
  { label: "down payment", pattern: /\bdown\s+payment\b/gi },
  { label: "upfront", pattern: /\bupfront\b/gi },
  { label: "COD", pattern: /\bcod\b/gi },
];

/** The blocked payment-term phrases present in a free-text note, if any. */
export function findBlockedPaymentTerms(text?: string | null): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const { label, pattern } of BLOCKED_NOTE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.push(label);
  }
  return found;
}

/**
 * The save-layer companion (lawyer ruling 2026-11-23; specced in the
 * PR #290 build record, built by the run-79 fix plan's Fix 1): the
 * refusal message for a free-text note carrying a blocked payment-term
 * phrase, or null when the note is clean. Saves are REFUSED with this
 * message and nothing is written \u2014 stored notes are never silently
 * rewritten; sanitizePrintedNotes below is what protects documents
 * from notes saved before this guard existed.
 */
export function blockedPaymentTermsMessage(text?: string | null): string | null {
  const found = findBlockedPaymentTerms(text);
  if (!found.length) return null;
  return `Notes can't include payment terms (${found.join(", ")}). Put payment terms in the Terms field \u2014 they print in the Terms of Sale.`;
}

/**
 * The notes text as it may print: blocked payment-term phrases removed
 * (the stored notes are never changed). Returns null when nothing
 * printable remains. Applied by every print model that carries the
 * quote's free-text notes, so a contradiction cannot reach a customer
 * document even from notes saved before this guard existed.
 */
export function sanitizePrintedNotes(notes?: string | null): string | null {
  if (!notes) return null;
  let out = notes;
  for (const { pattern } of BLOCKED_NOTE_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, "");
  }
  const lines = out
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/ +([.,;:!?])/g, "$1")
        .trim(),
    )
    .filter(Boolean);
  const joined = lines.join("\n").trim();
  return joined ? joined : null;
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
  /** The quote's payment-terms string (a Settings option such as "COD", or custom text). */
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
