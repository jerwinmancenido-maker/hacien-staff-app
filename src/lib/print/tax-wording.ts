// HIGH CARE: all tax / legal print wording for HACIEN documents lives here.
// HACIEN is NON-VAT on the 8% option. Do not add VAT lines anywhere.
// The official BIR invoice is the pre-printed booklet — system prints are not.

/** Registration status shown on every printable document letterhead. */
export const NON_VAT_LABEL = "NON-VAT" as const;

/**
 * UNVERIFIED BIR rule — Settings toggle (default ON for billing / collection).
 * Keep this phrase exact; do not invent variants elsewhere.
 */
export const INPUT_TAX_DISCLAIMER = "This document is not valid for claim of input tax" as const;

/** Required on billing and collection prints. */
export const NOT_OFFICIAL_INVOICE =
  "This is not an official invoice/receipt" as const;

/** Customer / supplier statements of account. */
export const STATEMENT_NOT_OFFICIAL =
  "Statement of account — not an official invoice/receipt" as const;

/** Supplier payment voucher: EWT / BIR Form 2307 note (when EWT was applied). */
export const EWT_2307_NOTE =
  "Expanded withholding tax (EWT) applied. BIR Form 2307 will be issued / was issued separately." as const;

/** Courtesy line on customer-facing documents. */
export const THANK_YOU = "Thank you for your business" as const;

/** Quotation / sales-order footer — not an invoice. Do not put on billing prints. */
export const QUOTATION_NOT_INVOICE = "This is a quotation, not an invoice." as const;

export type PrintDocKind =
  | "quote"
  | "sales_order"
  | "billing"
  | "collection"
  | "customer_statement"
  | "supplier_po"
  | "receiving_report"
  | "supplier_payment"
  | "expense"
  | "supplier_statement";

const BILLING_COLLECTION: ReadonlySet<PrintDocKind> = new Set(["billing", "collection"]);
const CUSTOMER_FACING: ReadonlySet<PrintDocKind> = new Set([
  "quote",
  "sales_order",
  "billing",
  "collection",
  "customer_statement",
]);
const STATEMENT_KINDS: ReadonlySet<PrintDocKind> = new Set(["customer_statement", "supplier_statement"]);
/** Quote + SO get the quotation disclaimer; billing keeps BIR wording only. */
const QUOTE_LIKE: ReadonlySet<PrintDocKind> = new Set(["quote", "sales_order"]);

/** Customer docs that hide internal status (WON / OPEN / …) on paper. */
export const HIDE_STATUS_ON_PRINT: ReadonlySet<PrintDocKind> = new Set(["quote", "sales_order", "billing"]);

/**
 * Legal / tax footer lines for a document kind.
 * `showInputTaxDisclaimer` comes from Settings (default true); only applied to
 * billing and collection when enabled.
 */
export function taxFooterLines(
  kind: PrintDocKind,
  opts: { showInputTaxDisclaimer: boolean } = { showInputTaxDisclaimer: true },
): string[] {
  const lines: string[] = [];
  if (QUOTE_LIKE.has(kind)) {
    lines.push(QUOTATION_NOT_INVOICE);
  }
  if (BILLING_COLLECTION.has(kind)) {
    lines.push(NOT_OFFICIAL_INVOICE);
    if (opts.showInputTaxDisclaimer) lines.push(INPUT_TAX_DISCLAIMER);
  }
  if (STATEMENT_KINDS.has(kind)) {
    lines.push(STATEMENT_NOT_OFFICIAL);
  }
  return lines;
}

export function isCustomerFacing(kind: PrintDocKind): boolean {
  return CUSTOMER_FACING.has(kind);
}

/** Forbidden substrings for regression tests — VAT must never appear on prints. */
export const FORBIDDEN_VAT_PHRASES = [
  "vat amount",
  "vat sales",
  "vatable",
  "output vat",
  "input vat",
  "12% vat",
  "vat-registered",
  "vat registered",
] as const;
