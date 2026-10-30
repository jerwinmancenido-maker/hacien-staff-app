// Column sets for each book-style register. Keep every register's columns here
// so accountant/RDO feedback can change the format in one place.
//
// UNVERIFIED: exact BIR book format (manual vs loose-leaf vs CAS, required
// columns). HACIEN is on the 8% income tax option and is non-VAT — do NOT add
// VAT or input-tax columns.

export type RegisterKey = "sales" | "disbursements" | "purchases" | "journal";

export type RegisterColumnKey = "date" | "documentNumber" | "party" | "particulars" | "amount" | "ewt" | "source";

export type RegisterColumn = {
  key: RegisterColumnKey;
  /** Plain label for staff (table header / CSV / print). */
  label: string;
  align?: "left" | "right";
  money?: boolean;
  /** When true, blank cells are fine (e.g. EWT not on every row). */
  optional?: boolean;
};

export type RegisterSourceKind = "BILLING" | "COLLECTION" | "SUPPLIER_PAYMENT" | "EXPENSE" | "SUPPLIER_BILL";

export type RegisterConfig = {
  key: RegisterKey;
  /** Short nav label. */
  label: string;
  /** Page title. */
  title: string;
  /** One-line plain explanation. */
  subtitle: string;
  /** Empty-state copy: which records feed this register. */
  emptyFeeds: string;
  columns: readonly RegisterColumn[];
  /** Source kinds included (voided always excluded). */
  sources: readonly RegisterSourceKind[];
  /** Rows per printed page before a page-total line (loose-leaf style). */
  rowsPerPage: number;
  /** Path segment under /books and /print/books. */
  path: string;
};

const BASE_COLUMNS: readonly RegisterColumn[] = [
  { key: "date", label: "Date" },
  { key: "documentNumber", label: "Document no." },
  { key: "party", label: "Party" },
  { key: "particulars", label: "Particulars" },
  { key: "amount", label: "Amount", align: "right", money: true },
  { key: "ewt", label: "EWT", align: "right", money: true, optional: true },
];

/**
 * Single place to edit register columns. No VAT / input-tax fields — HACIEN is non-VAT.
 * Confirm with accountant/RDO before treating these as official books.
 */
export const REGISTER_CONFIGS: Record<RegisterKey, RegisterConfig> = {
  sales: {
    key: "sales",
    label: "Sales",
    title: "Sales register",
    subtitle:
      "Billings and collections listed together; period totals stay separate (Invoiced vs Collected). Draft — not a tax basis.",
    emptyFeeds:
      "This register is built from non-void billings (sales invoices) and collections (cash receipts). Record those under Billing & Collections first.",
    columns: BASE_COLUMNS,
    sources: ["BILLING", "COLLECTION"],
    rowsPerPage: 25,
    path: "sales",
  },
  disbursements: {
    key: "disbursements",
    label: "Cash disbursements",
    title: "Cash disbursements register",
    subtitle: "Money paid out — supplier payments and expenses.",
    emptyFeeds:
      "This register is built from non-void supplier payments (Payables) and expenses (Cash). Record those first, then come back here.",
    columns: BASE_COLUMNS,
    sources: ["SUPPLIER_PAYMENT", "EXPENSE"],
    rowsPerPage: 25,
    path: "disbursements",
  },
  purchases: {
    key: "purchases",
    label: "Purchases",
    title: "Purchases register",
    subtitle: "Supplier bills recorded in Purchasing / Payables.",
    emptyFeeds:
      "This register is built from non-void supplier bills. Record a supplier bill on a purchase order (or under the supplier) first.",
    // Purchases book usually has no EWT column (EWT is at payment). Easy to add back here.
    columns: [
      { key: "date", label: "Date" },
      { key: "documentNumber", label: "Document no." },
      { key: "party", label: "Party" },
      { key: "particulars", label: "Particulars" },
      { key: "amount", label: "Amount", align: "right", money: true },
    ],
    sources: ["SUPPLIER_BILL"],
    rowsPerPage: 25,
    path: "purchases",
  },
  journal: {
    key: "journal",
    label: "General journal",
    title: "General journal",
    subtitle: "All book rows in date order — sales, purchases, and cash out.",
    emptyFeeds:
      "This list combines non-void billings, collections, supplier bills, supplier payments, and expenses for the period.",
    columns: [
      { key: "date", label: "Date" },
      { key: "source", label: "Source" },
      { key: "documentNumber", label: "Document no." },
      { key: "party", label: "Party" },
      { key: "particulars", label: "Particulars" },
      { key: "amount", label: "Amount", align: "right", money: true },
      { key: "ewt", label: "EWT", align: "right", money: true, optional: true },
    ],
    sources: ["BILLING", "COLLECTION", "SUPPLIER_BILL", "SUPPLIER_PAYMENT", "EXPENSE"],
    rowsPerPage: 25,
    path: "journal",
  },
};

export const REGISTER_KEYS = Object.keys(REGISTER_CONFIGS) as RegisterKey[];

export function isRegisterKey(value: string): value is RegisterKey {
  return value in REGISTER_CONFIGS;
}

/** Draft banner — BIR book format is unverified. */
export const BOOKS_DRAFT_BANNER =
  "Draft format — confirm with accountant/RDO before using as official books";

export const BOOKS_DISCLAIMER =
  "Read-only export from existing records. HACIEN is non-VAT (8% income tax option) — no VAT or input tax is computed.";

/** Forbidden column / field names — never appear on Books registers (non-VAT). */
export const BOOKS_FORBIDDEN_VAT_KEYS = [
  "vat",
  "VAT",
  "inputTax",
  "input_tax",
  "outputTax",
  "output_tax",
  "vatAmount",
  "vat_amount",
] as const;
