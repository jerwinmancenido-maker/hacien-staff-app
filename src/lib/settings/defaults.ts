import type { Settings } from "./schema";

// Seed defaults only. The app always reads settings from the database.
// Tax calendar obligation defaults mirror src/lib/tax/calendar-obligations.ts
// (kept inline so prisma/seed.mts can load this file without a deep .ts import chain).
export const DEFAULT_SETTINGS: Settings = {
  approval: { marginBelowPct: 18, totalAbove: 500_000 },
  quotes: { defaultValidityDays: 30 },
  numbering: {
    quote: { prefix: "QT", padding: 4, resetYearly: true },
    salesOrder: { prefix: "SO", padding: 4, resetYearly: true },
    supplierPo: { prefix: "PO", padding: 4, resetYearly: true },
    receivingReport: { prefix: "RR", padding: 4, resetYearly: true },
    billing: { prefix: "BL", padding: 4, resetYearly: true },
    collection: { prefix: "CR", padding: 4, resetYearly: true },
    supplierPayment: { prefix: "PAY", padding: 4, resetYearly: true },
    expense: { prefix: "EXP", padding: 4, resetYearly: true },
    cashTransfer: { prefix: "TRF", padding: 4, resetYearly: true },
  },
  taxYear: { year: 2026, nonVatLimit: 3_000_000, warnFirstPct: 70, warnSecondPct: 90 },
  company: { name: "HACIEN", tin: "", address: "" },
  lists: {
    paymentTerms: ["COD", "Net 15", "Net 30", "Net 60", "50% down, 50% on delivery"],
    contactRoles: ["End user", "Procurement", "Accounting", "Other"],
  },
  documents: { expiryWarningDays: 30 },
  invoiceBooklet: { seriesFrom: 1, seriesTo: 500, label: "Booklet 1" },
  collections: { overdueGraceDays: 0 },
  features: { payablesEnabled: false, cashEnabled: false, booksEnabled: false },
  taxCalendar: {
    corUploadedAndChecked: false,
    obligations: {
      "1701q": { enabled: true, dueDay: 15, dueMonth: null },
      "1701": { enabled: true, dueDay: 15, dueMonth: 4 },
      "2551q": { enabled: true, dueDay: 15, dueMonth: null },
      "2550q": { enabled: true, dueDay: 25, dueMonth: null },
      "0619e": { enabled: false, dueDay: 10, dueMonth: null },
      "1601eq": { enabled: false, dueDay: null, dueMonth: null },
      books_accounts: { enabled: true, dueDay: null, dueMonth: null },
      inventory_list: { enabled: true, dueDay: null, dueMonth: null },
    },
  },
};
