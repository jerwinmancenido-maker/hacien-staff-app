import type { Settings } from "./schema";

// Seed defaults only. The app always reads settings from the database.
export const DEFAULT_SETTINGS: Settings = {
  approval: { marginBelowPct: 18, totalAbove: 500_000 },
  quotes: { defaultValidityDays: 30 },
  numbering: {
    quote: { prefix: "QT", padding: 4, resetYearly: true },
    salesOrder: { prefix: "SO", padding: 4, resetYearly: true },
    supplierPo: { prefix: "PO", padding: 4, resetYearly: true },
  },
  taxYear: { year: 2026, nonVatLimit: 3_000_000, warnFirstPct: 70, warnSecondPct: 90 },
  company: { name: "HACIEN", tin: "", address: "" },
  lists: {
    paymentTerms: ["COD", "Net 15", "Net 30", "Net 60", "50% down, 50% on delivery"],
    contactRoles: ["End user", "Procurement", "Accounting", "Other"],
  },
  documents: { expiryWarningDays: 30 },
};
