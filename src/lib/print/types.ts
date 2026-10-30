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
  qty: string;
  unit: string;
  unitPrice: string;
  amount: string;
};

export type PrintMoneyLine = { label: string; amount: string; emphasize?: boolean };

export type PrintSignatory = {
  role: "Prepared by" | "Approved by" | "Received by";
  name: string | null;
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
  /** Last 4 digits only — never the full account number. */
  accountLast4: string;
};

export type ProfessionalPrintModel = {
  kind: PrintDocKind;
  paperSize: PaperSize;
  title: string;
  number: string;
  date: string;
  status: string;
  watermark: "DRAFT" | "VOID" | null;
  company: PrintCompanyBlock;
  party: PrintPartyBlock;
  meta: PrintMetaRow[];
  /** Line items table; omit for pure ledger statements. */
  items?: PrintLineItem[];
  /** Unit price column header (e.g. "Unit price" vs "Unit cost"). */
  unitPriceLabel?: string;
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
