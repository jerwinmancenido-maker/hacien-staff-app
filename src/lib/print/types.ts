// Shared shape for every professional print / PDF document.

import type { PrintDocKind } from "./tax-wording";

export type PaperSize = "A4" | "Letter";

export type PrintCompanyBlock = {
  registeredName: string;
  tradeName: string;
  tin: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Public URL for the logo image, or null to fall back to the name. */
  logoUrl: string | null;
};

export type PrintPartyBlock = {
  label: string;
  name: string;
  tin: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
};

export type PrintMetaRow = { label: string; value: string };

export type PrintLineItem = {
  description: string;
  /** Optional secondary line under the description (never cost/margin). */
  detail?: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  amount: string;
};

export type PrintMoneyLine = { label: string; amount: string; emphasize?: boolean };

export type PrintSignatory = {
  role: "Prepared by" | "Approved by" | "Received by" | "Conforme";
  name: string | null;
  /** Job title / position from the user profile when set. */
  position?: string | null;
};

/** Statement-style ledger line (SOA). */
export type PrintLedgerLine = {
  date: string;
  description: string;
  charges: string | null;
  credits: string | null;
  balance: string;
};

export type PrintPaymentInstruction = {
  kind: "bank" | "ewallet";
  label: string;
  accountName: string;
  /** Last 4 digits (always available). */
  accountLast4: string;
  /**
   * What to print: `****1234` by default, or the full number when the per-account
   * "Print full account number" toggle is ON and a full number was entered.
   * Fixtures/snapshots must only ever use the masked form.
   */
  accountPrinted: string;
};

export type ProfessionalPrintModel = {
  kind: PrintDocKind;
  paperSize: PaperSize;
  title: string;
  number: string;
  date: string;
  status: string;
  /**
   * When true, the printed document omits the internal status (WON / OPEN / …).
   * Screen toolbars may still show it.
   */
  hideStatus?: boolean;
  watermark: "DRAFT" | "VOID" | null;
  company: PrintCompanyBlock;
  party: PrintPartyBlock;
  meta: PrintMetaRow[];
  /**
   * Optional full-width subject line above the items table (quotes).
   * Kept out of the narrow right meta column so long subjects don't wrap badly.
   */
  subject?: string | null;
  /** Line items table; omit for pure ledger statements. */
  items?: PrintLineItem[];
  /** Unit price column header (e.g. "Unit price" vs "Unit cost"). */
  unitPriceLabel?: string;
  /** When true, omit unit-price and amount columns (e.g. RR qty-only). */
  hideLineAmounts?: boolean;
  totals?: PrintMoneyLine[];
  totalInWords?: string;
  /** Statement of account ledger. */
  ledger?: {
    openingBalance: string;
    lines: PrintLedgerLine[];
    closingBalance: string;
    aging?: { label: string; amount: string }[];
  };
  terms?: string | null;
  validity?: string | null;
  notes?: string | null;
  deliveryNotes?: string | null;
  warrantyNotes?: string | null;
  paymentInstructions?: PrintPaymentInstruction[];
  signatories?: PrintSignatory[];
  thankYou?: boolean;
  /** Extra legal / tax lines (from tax-wording module). */
  taxLines: string[];
  /** Optional EWT/2307 note on supplier payment vouchers. */
  ewtNote?: string | null;
  qrSvg?: string | null;
  termsUrl?: string | null;
  contactLine: string;
};
