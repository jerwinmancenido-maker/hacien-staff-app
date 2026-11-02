import type { ProfessionalPrintModel } from "@/lib/print/types";
import {
  INPUT_TAX_DISCLAIMER,
  NOT_OFFICIAL_INVOICE,
  QUOTATION_NOT_INVOICE,
  SALES_ORDER_NOT_INVOICE,
  STATEMENT_NOT_OFFICIAL,
} from "@/lib/print/tax-wording";

const company = {
  registeredName: "HACIEN Sample Trading Co.",
  tradeName: "HACIEN",
  tin: "123-456-789-000",
  address: "Unit 1, Sample St.\nQuezon City 1100",
  phone: "+63 2 8123 4567",
  email: "billing@example.com",
  website: "https://example.com",
  logoUrl: "/brand/logo-full.svg" as string | null,
};

const customerParty = {
  label: "Customer",
  name: "TESDA Regional Office (Sample)",
  tin: "000-111-222-000",
  billingAddress: "Quezon City",
  deliveryAddress: "Pasig City Warehouse",
  contactPerson: "Ana Cruz",
  phone: "+63 917 000 0001",
  email: "ana@example.com",
};

const supplierParty = {
  label: "Supplier",
  name: "UNO Computer Supply (Sample)",
  tin: "000-333-444-000",
  billingAddress: "Makati City",
  deliveryAddress: "HACIEN warehouse",
  contactPerson: "Ben Santos",
  phone: "+63 917 000 0002",
  email: "ben@example.com",
};

const items = [
  {
    description: "Laptop i5 (sample)",
    qty: "10.00",
    unit: "pc",
    unitPrice: "52000.00",
    amount: "520000.00",
  },
];

function base(partial: Partial<ProfessionalPrintModel> & Pick<ProfessionalPrintModel, "kind" | "title">): ProfessionalPrintModel {
  return {
    paperSize: "A4",
    number: "DOC-2026-0001",
    date: "Oct 30, 2026",
    status: "OPEN",
    watermark: null,
    company,
    party: customerParty,
    meta: [],
    items,
    totals: [
      { label: "Subtotal", amount: "520000.00" },
      { label: "Total", amount: "520000.00", emphasize: true },
    ],
    totalInWords: "Five hundred twenty thousand pesos only",
    taxLines: [],
    contactLine: "+63 2 8123 4567 · billing@example.com",
    thankYou: false,
    ...partial,
  };
}

export const quotePrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "quote",
    title: "QUOTATION",
    number: "QT-2026-0001",
    status: "SENT",
    hideStatus: true,
    thankYou: true,
    meta: [
      { label: "Valid until", value: "Nov 30, 2026" },
      { label: "Prepared by", value: "Jerwin" },
    ],
    validity: "Nov 30, 2026",
    taxLines: [QUOTATION_NOT_INVOICE, INPUT_TAX_DISCLAIMER],
    paymentInstructions: [
      { kind: "bank", label: "Sample Bank", accountName: "HACIEN Sample", accountLast4: "1234", accountPrinted: "****1234" },
    ],
    signatories: [
      { role: "Prepared by", name: "Jerwin", position: null },
      { role: "Conforme", name: null },
    ],
  });

/** Quote for a customer that withholds internally — print still Subtotal+Total only. */
export const withholdingQuotePrintFixture = (): ProfessionalPrintModel =>
  base({
    ...quotePrintFixture(),
    number: "QT-2026-0002",
    totals: [
      { label: "Subtotal", amount: "520000.00" },
      { label: "Total", amount: "520000.00", emphasize: true },
    ],
  });

export const salesOrderPrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "sales_order",
    title: "SALES ORDER",
    number: "SO-2026-0001",
    hideStatus: true,
    thankYou: true,
    taxLines: [SALES_ORDER_NOT_INVOICE, INPUT_TAX_DISCLAIMER],
    meta: [
      { label: "Prepared by", value: "Jerwin" },
      { label: "Customer PO/ref", value: "PO-CUST-99" },
    ],
    signatories: [
      { role: "Prepared by", name: "Jerwin", position: null },
      { role: "Conforme", name: null },
    ],
  });

export const billingPrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "billing",
    title: "BILLING STATEMENT",
    number: "BL-2026-0001",
    hideStatus: true,
    thankYou: true,
    taxLines: [NOT_OFFICIAL_INVOICE, INPUT_TAX_DISCLAIMER],
    paymentInstructions: [
      { kind: "ewallet", label: "GCash", accountName: "HACIEN", accountLast4: "5678", accountPrinted: "****5678" },
    ],
    signatories: [
      { role: "Prepared by", name: "Jerwin", position: null },
      { role: "Conforme", name: null },
    ],
  });

export const collectionPrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "collection",
    title: "Collection Acknowledgement",
    number: "CR-2026-0001",
    thankYou: true,
    taxLines: [NOT_OFFICIAL_INVOICE, INPUT_TAX_DISCLAIMER],
  });

export const poPrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "supplier_po",
    title: "Purchase Order",
    number: "PO-2026-0001",
    party: supplierParty,
    unitPriceLabel: "Unit cost",
    items: [{ description: "Laptop i5 (sample)", qty: "10.00", unit: "pc", unitPrice: "40000.00", amount: "400000.00" }],
    totals: [
      { label: "Subtotal", amount: "400000.00" },
      { label: "Total", amount: "400000.00", emphasize: true },
    ],
    totalInWords: "Four hundred thousand pesos only",
  });

/** Default RR print: qty only (costs hidden). */
export const rrPrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "receiving_report",
    title: "Receiving Report",
    number: "RR-2026-0001",
    party: supplierParty,
    hideLineAmounts: true,
    items: [{ description: "Laptop i5 (sample)", qty: "10.00", unit: "pc", unitPrice: "0.00", amount: "0.00" }],
    totals: undefined,
    totalInWords: undefined,
  });

/** RR print with costs (setting ON + cost-view user). */
export const rrPrintWithCostsFixture = (): ProfessionalPrintModel =>
  base({
    kind: "receiving_report",
    title: "Receiving Report",
    number: "RR-2026-0001",
    party: supplierParty,
    hideLineAmounts: false,
    unitPriceLabel: "Unit cost",
    items: [{ description: "Laptop i5 (sample)", qty: "10.00", unit: "pc", unitPrice: "40000.00", amount: "400000.00" }],
    totals: [
      { label: "Subtotal", amount: "400000.00" },
      { label: "Total", amount: "400000.00", emphasize: true },
    ],
    totalInWords: "Four hundred thousand pesos only",
  });

export const supplierPaymentPrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "supplier_payment",
    title: "Supplier Payment Voucher",
    number: "PAY-2026-0001",
    party: supplierParty,
    unitPriceLabel: "Unit cost",
    items: [{ description: "Payment for bill INV-SAMPLE-1", qty: "1.00", unit: "lot", unitPrice: "400000.00", amount: "400000.00" }],
    totals: [
      { label: "Amount paid", amount: "400000.00" },
      { label: "EWT withheld", amount: "4000.00" },
      { label: "Total applied (cash + EWT)", amount: "404000.00", emphasize: true },
    ],
    totalInWords: "Four hundred thousand pesos only",
    ewtNote: "Expanded withholding tax (EWT) applied. BIR Form 2307 will be issued / was issued separately.",
  });

export const expensePrintFixture = (): ProfessionalPrintModel =>
  base({
    kind: "expense",
    title: "Expense Voucher",
    number: "EXP-2026-0001",
    party: { ...supplierParty, label: "Payee", name: "Office Rent (Sample)", deliveryAddress: null },
    unitPriceLabel: "Rate",
    items: [{ description: "Office rent — sample month", qty: "1.00", unit: "lot", unitPrice: "15000.00", amount: "15000.00" }],
    totals: [{ label: "Total", amount: "15000.00", emphasize: true }],
    totalInWords: "Fifteen thousand pesos only",
  });

export const customerStatementFixture = (): ProfessionalPrintModel =>
  base({
    kind: "customer_statement",
    title: "Statement of Account",
    number: "TESDA Regional Office (Sample)",
    items: undefined,
    totals: undefined,
    thankYou: true,
    taxLines: [STATEMENT_NOT_OFFICIAL, INPUT_TAX_DISCLAIMER],
    ledger: {
      openingBalance: "0.00",
      closingBalance: "10000.00",
      lines: [
        {
          date: "Oct 1, 2026",
          description: "Booklet invoice #1 · due Oct 31, 2026",
          charges: "10000.00",
          credits: null,
          balance: "10000.00",
        },
      ],
      aging: [{ label: "Current", amount: "10000.00" }],
    },
    totalInWords: "Ten thousand pesos only",
  });

export const supplierStatementFixture = (): ProfessionalPrintModel =>
  base({
    kind: "supplier_statement",
    title: "Supplier Statement of Account",
    number: "UNO Computer Supply (Sample)",
    party: supplierParty,
    items: undefined,
    totals: undefined,
    taxLines: [STATEMENT_NOT_OFFICIAL],
    ledger: {
      openingBalance: "0.00",
      closingBalance: "5000.00",
      lines: [
        {
          date: "Oct 5, 2026",
          description: "Bill INV-SAMPLE-1",
          charges: "5000.00",
          credits: null,
          balance: "5000.00",
        },
      ],
    },
    totalInWords: "Five thousand pesos only",
  });

export const voidQuoteFixture = (): ProfessionalPrintModel => ({
  ...quotePrintFixture(),
  status: "VOID",
  watermark: "VOID",
});

export const draftPoFixture = (): ProfessionalPrintModel => ({
  ...poPrintFixture(),
  status: "DRAFT",
  watermark: "DRAFT",
});

/** Long quote (25 lines) for pagination fixtures / screenshots. */
export const longQuotePrintFixture = (): ProfessionalPrintModel => {
  const q = quotePrintFixture();
  const many = Array.from({ length: 25 }, (_, i) => ({
    description: `Sample line item ${i + 1}`,
    detail: i % 5 === 0 ? "Optional detail line" : null,
    qty: "1.00",
    unit: "pc",
    unitPrice: "1000.00",
    amount: "1000.00",
  }));
  return {
    ...q,
    number: "QT-2026-0025",
    items: many,
    totals: [
      { label: "Subtotal", amount: "25000.00" },
      { label: "Total", amount: "25000.00", emphasize: true },
    ],
    totalInWords: "Twenty-five thousand pesos only",
  };
};
