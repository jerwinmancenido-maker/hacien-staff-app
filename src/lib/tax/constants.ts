// Tax worksheet constants for HACIEN (non-VAT, 8% income tax option).
//
// UNVERIFIED — confirm every figure and rule with the accountant / RDO before
// filing. This app never files returns and never connects to BIR or eBIRForms.
// Values here are working assumptions for worksheets only.

/** Banner on every tax worksheet screen and print/PDF. */
export const TAX_WORKSHEET_BANNER =
  "Worksheet only — check with your accountant before filing. Not filed by this app.";

/** Short disclaimer under page titles. */
export const TAX_WORKSHEET_DISCLAIMER =
  "Preparation aid for the owner and accountant. HACIEN is non-VAT — no VAT is shown or computed. Nothing is filed by this app.";

/**
 * UNVERIFIED: ₱250,000 annual allowance under the 8% income tax option for a
 * sole proprietor. Confirm with accountant before relying on this figure.
 */
export const ALLOWANCE_8PCT_PESOS = "250000.00";

/** Staff-facing label for the allowance line (must stay next to the amount). */
export const ALLOWANCE_8PCT_LABEL = "for 8% option, sole proprietor — confirm";

/**
 * UNVERIFIED: 8% income tax rate on taxable receipts (after allowance) under
 * the optional 8% tax on gross sales/receipts.
 */
export const INCOME_TAX_RATE_8PCT = "0.0800";

/**
 * UNVERIFIED: ₱3,000,000 VAT threshold / non-VAT ceiling. Crossing it may end
 * both non-VAT status and eligibility for the 8% option — accountant must advise.
 */
export const NON_VAT_THRESHOLD_PESOS = "3000000.00";

/** Red warning when invoiced or collected cumulative exceed the non-VAT threshold. */
export const OVER_THRESHOLD_WARNING =
  "Cumulative sales exceed ₱3,000,000. The 8% option and non-VAT status may no longer apply — consult your accountant before filing.";

/**
 * Shown on the 1701Q worksheet until the accountant confirms tax basis.
 * Do not pick invoiced vs collected in the app.
 */
export const TAX_BASIS_UNVERIFIED_NOTE =
  "Basis UNVERIFIED: accountant to confirm invoiced vs collected.";

/** Staff-facing labels for the two cumulative figures (not a chosen basis). */
export const INVOICED_TOTAL_LABEL = "Invoiced total";
export const COLLECTED_TOTAL_LABEL = "Collected total";

/** Note on the supplier EWT worksheet (HACIEN may or may not be a withholding agent). */
export const SUPPLIER_EWT_RDO_NOTE =
  "Only applies if HACIEN is registered to withhold — confirm with RDO.";

/** CSV format labels — column layouts are UNVERIFIED drafts, not official BIR files. */
export const SAWT_CSV_FORMAT_LABEL = "UNVERIFIED format";
export const QAP_CSV_FORMAT_LABEL = "UNVERIFIED";

/** Form / worksheet title for the quarterly income tax worksheet. */
export const INCOME_TAX_WORKSHEET_TITLE = "Quarterly income tax worksheet (1701Q, 8% option)";

/** One-line hints shown next to each 1701Q worksheet line. */
export const INCOME_TAX_LINE_HINTS = {
  a: "Two figures from January to the end of the quarter — not combined, and neither is chosen as the tax basis yet",
  invoiced: "Non-void billings by invoice date (sales invoiced)",
  collected: "Non-void collections by collection date (cash and receipts collected)",
  b: "Annual allowance under the 8% option (confirm with your accountant)",
  c: "Sales after the allowance; never below zero",
  d: "Taxable amount × 8%",
  e: "What you already paid for earlier quarters this year (type the amount from your bank / OR)",
  f: "Creditable tax withheld by customers (from 2307s / collections EWT)",
  g: "Tax due minus credits — negative means overpayment",
} as const;

/** Nav / page copy for the four worksheets. */
export const TAX_WORKSHEET_PAGES = {
  home: {
    key: "home" as const,
    label: "Overview",
    title: "Tax worksheets",
    href: "/books/tax",
    subtitle: "Prepare figures for returns. Nothing is filed here.",
  },
  income: {
    key: "income" as const,
    label: "1701Q (8%)",
    title: INCOME_TAX_WORKSHEET_TITLE,
    href: "/books/tax/income",
    subtitle: "Quarterly income tax under the 8% option — line-by-line math.",
    empty: "No sales in this period yet. Record billings under Billing & Collections first.",
  },
  received2307: {
    key: "received2307" as const,
    label: "2307s received",
    title: "2307s received from customers",
    href: "/books/tax/2307-received",
    subtitle: "Creditable withholding certificates from customers, by quarter.",
    empty: "No customer 2307s in this quarter. Record collections with EWT under Billing first.",
  },
  supplierEwt: {
    key: "supplierEwt" as const,
    label: "EWT withheld",
    title: "EWT withheld on supplier payments",
    href: "/books/tax/ewt-withheld",
    subtitle: "Expanded withholding on supplier payments (Part 6), by month and quarter.",
    empty: "No supplier EWT in this period. Record supplier payments with withholding under Payables first.",
  },
  salesSummary: {
    key: "salesSummary" as const,
    label: "Sales summary",
    title: "Sales summary by month",
    href: "/books/tax/sales-summary",
    subtitle: "Monthly gross sales for the year — supports the books and returns.",
    empty: "No non-void billings in this year yet.",
  },
} as const;
