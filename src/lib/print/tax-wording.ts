// HIGH CARE: all tax / legal print wording for HACIEN documents lives here.
// HACIEN is NON-VAT on the 8% option. Do not add VAT lines anywhere.
// The official BIR invoice is the pre-printed booklet — system prints are not.

/** Registration status shown on every printable document letterhead. */
export const NON_VAT_LABEL = "NON-VAT" as const;

/**
 * Exact customer-print line. Always on for billing, collection, quote, sales
 * order, and the customer statement. Not gated by Settings.
 * Keep this phrase exact; do not invent variants elsewhere.
 */
export const INPUT_TAX_DISCLAIMER = "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX." as const;

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

/** Quotation footer — not an invoice. Do not put on billing or sales-order prints. */
export const QUOTATION_NOT_INVOICE = "This is a quotation, not an invoice." as const;

/** Sales-order footer — not an invoice. Do not put on billing or quote prints. */
export const SALES_ORDER_NOT_INVOICE = "This is a sales order, not an invoice." as const;

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
/** Outside prints hide internal status (WON / OPEN / SENT / …). */
export const HIDE_STATUS_ON_PRINT: ReadonlySet<PrintDocKind> = new Set([
  "quote",
  "sales_order",
  "billing",
  "collection",
  "customer_statement",
  "supplier_po",
  "receiving_report",
  "supplier_payment",
  "expense",
  "supplier_statement",
]);

/** The five customer prints that always carry the input-tax line. */
const INPUT_TAX_ALWAYS: ReadonlySet<PrintDocKind> = new Set([
  "quote",
  "sales_order",
  "billing",
  "collection",
  "customer_statement",
]);

/**
 * Legal / tax footer lines for a document kind.
 * `showInputTaxDisclaimer` is accepted and ignored: the input-tax line is
 * always printed on the five customer prints, even when that old toggle is off.
 * Supplier statements do not get the line.
 */
export function taxFooterLines(
  kind: PrintDocKind,
  opts: { showInputTaxDisclaimer?: boolean } = {},
): string[] {
  void opts;
  const lines: string[] = [];
  if (kind === "quote") {
    lines.push(QUOTATION_NOT_INVOICE);
  }
  if (kind === "sales_order") {
    lines.push(SALES_ORDER_NOT_INVOICE);
  }
  if (BILLING_COLLECTION.has(kind)) {
    lines.push(NOT_OFFICIAL_INVOICE);
  }
  if (STATEMENT_KINDS.has(kind)) {
    lines.push(STATEMENT_NOT_OFFICIAL);
  }
  if (INPUT_TAX_ALWAYS.has(kind)) {
    lines.push(INPUT_TAX_DISCLAIMER);
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
