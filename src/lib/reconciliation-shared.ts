// Reconciliation gap reasons (Reconciliation Plan 2026-11-19, PR-C).
// Client-safe: preset codes + labels for the "why is there no document
// yet" note on a sales order / purchase order. These record FACTS about
// documents (a customer who did not ask for an invoice; a supplier who
// did not issue one). They change no total, Book entry, print or filing
// output, and the app does not track filing choices.

export const SO_GAP_REASONS = [
  { code: "CUSTOMER_NO_INVOICE", label: "Customer did not request an invoice" },
  { code: "BILLING_PENDING", label: "Billing pending details" },
  { code: "OTHER", label: "Other (write a note)" },
] as const;

export const PO_GAP_REASONS = [
  { code: "SUPPLIER_NO_INVOICE", label: "Supplier did not issue an invoice" },
  { code: "INVOICE_AWAITED", label: "Invoice awaited" },
  { code: "OTHER", label: "Other (write a note)" },
] as const;

export type GapReasonCode = (typeof SO_GAP_REASONS)[number]["code"] | (typeof PO_GAP_REASONS)[number]["code"];

const ALL_LABELS = new Map<string, string>([...SO_GAP_REASONS, ...PO_GAP_REASONS].map((r) => [r.code, r.label]));

/** Display label for a stored code; null when no reason is recorded. */
export function gapReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ALL_LABELS.get(code) ?? code;
}

export function isSoGapReason(code: string): boolean {
  return SO_GAP_REASONS.some((r) => r.code === code);
}

export function isPoGapReason(code: string): boolean {
  return PO_GAP_REASONS.some((r) => r.code === code);
}

/** Aging buckets for reconciliation rows (days since the gap opened). */
export type AgingBucket = "0-7" | "8-30" | "31-90" | "90+";

export function agingBucket(daysOpen: number): AgingBucket {
  if (daysOpen <= 7) return "0-7";
  if (daysOpen <= 30) return "8-30";
  if (daysOpen <= 90) return "31-90";
  return "90+";
}
