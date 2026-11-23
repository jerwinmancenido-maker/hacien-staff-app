// HIGH CARE: all tax / legal print wording for HACIEN documents lives here.
// HACIEN is NON-VAT on the 8% option. Do not add VAT lines anywhere.
// The official BIR invoice is the pre-printed booklet — system prints are not.
// Governing policy: BIR-WORDING.md (repo root). The disclaimer constants
// below are that file's approved texts — wording changes need Jerwin's
// approval and updated legal verification (see BIR-WORDING.md rule 3).

/** Registration status shown on every printable document letterhead. */
export const NON_VAT_LABEL = "NON-VAT" as const;

/**
 * Exact input-tax footer. Billing and collection only (see BIR-WORDING.md).
 * Keep this phrase exact; do not invent variants elsewhere.
 */
export const INPUT_TAX_DISCLAIMER = "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX." as const;

/**
 * The ONE billing disclaimer for every billing / statement surface:
 * billing + collection prints, statement prints, the statement data's
 * disclaimer field, statement reminder emails, and the on-screen billing
 * pages (BIR-WORDING.md rule 2). Document titles stay in the document
 * headers — this text never carries a title. Approved by Jerwin
 * 2026-11-23 on the OpenBot lawyer ruling (Primary text: HACIEN holds
 * ATP Collection Receipts and ATP Delivery Receipts).
 */
export const BILLING_DISCLAIMER =
  "For reference only — NOT a BIR-registered Sales Invoice or Collection/Official Receipt, and NOT valid for claiming input tax. Official BIR-registered Non-VAT Sales Invoices (and Collection Receipts, where applicable) are issued separately." as const;

/**
 * Packing list attachment sheet only (BIR-WORDING.md rule 2). Never used
 * on billing surfaces — those use BILLING_DISCLAIMER.
 */
export const PACKING_LIST_DISCLAIMER =
  "PACKING LIST / ATTACHMENT ONLY — NOT A BIR-REGISTERED SALES INVOICE, DELIVERY RECEIPT, OR COLLECTION/OFFICIAL RECEIPT. Not valid for claiming input tax; must accompany the official HACIEN Non-VAT Sales Invoice or BIR-registered Delivery Receipt." as const;

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

/** Billing and collection always carry the input-tax line (not quote / SO / statements). */
const INPUT_TAX_KINDS: ReadonlySet<PrintDocKind> = BILLING_COLLECTION;

/**
 * Legal / tax footer lines for a document kind.
 * `showInputTaxDisclaimer` is accepted and ignored: the input-tax line is
 * always printed on billing and collection, even when that old toggle is off.
 * Quote, SO, and statements do not get the line.
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
    lines.push(BILLING_DISCLAIMER);
  }
  if (STATEMENT_KINDS.has(kind)) {
    lines.push(BILLING_DISCLAIMER);
  }
  if (INPUT_TAX_KINDS.has(kind)) {
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
