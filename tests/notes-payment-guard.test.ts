// Run-79 fix plan, Fix 1 (F-G): the save-layer Remarks guard.
//
// Lawyer ruling 2026-11-23: the printed Terms of Sale is the single
// source of truth, so a free-text note that prints on a customer
// document can never carry payment-term wording that contradicts it.
// PR #290 stripped such phrases at the PRINT layer only (stored notes
// untouched); this guard refuses them at SAVE — validation rejects the
// note and nothing is written. Stored notes are never silently
// rewritten. The service paths that copy stored notes verbatim
// (quote copy, quote→SO conversion) are covered in
// tests/db/notes-payment-guard.db.test.ts.
import { describe, expect, it } from "vitest";
import { quoteInputSchema, salesOrderInputSchema } from "@/lib/validation/quotes";
import { billingInputSchema } from "@/lib/validation/billing";
import { blockedPaymentTermsMessage, findBlockedPaymentTerms } from "@/lib/print/terms-block";
import { addDays, isoDate, manilaToday } from "@/lib/format";

// The print layer's own proof string (run 79, Layer 4).
const BLOCKED_NOTE = "pay COD or 50/50 split, Net 30 if late";
const CLEAN_NOTE = "Deliver to the warehouse gate; call the guard on arrival.";

const item = { id: null, description: "Laptop", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "1000", supplierUnitCost: "0" } as const;

function quoteInput(notes: string, extra: Record<string, unknown> = {}) {
  const today = manilaToday();
  return {
    customerId: "cust_1",
    contactId: null,
    date: isoDate(today),
    validUntil: isoDate(addDays(today, 30)),
    // Payment terms belong in the Terms field — it is never guarded.
    terms: "Net 30",
    notes,
    items: [item],
    ...extra,
  };
}

function notesIssue(parsed: { success: boolean; error?: { issues: { path: unknown[]; message: string }[] } }) {
  if (parsed.success || !parsed.error) return null;
  return parsed.error.issues.find((i) => i.path.join(".") === "notes") ?? null;
}

describe("save-layer notes guard — the shared message", () => {
  it("names every blocked phrase found in the print layer's proof string", () => {
    expect(findBlockedPaymentTerms(BLOCKED_NOTE)).toEqual(["Net <days>", "50/50", "COD"]);
    const message = blockedPaymentTermsMessage(BLOCKED_NOTE);
    expect(message).toContain("Notes can't include payment terms");
    expect(message).toContain("Net <days>");
    expect(message).toContain("50/50");
    expect(message).toContain("COD");
  });

  it("is null for clean, empty and missing notes", () => {
    expect(blockedPaymentTermsMessage(CLEAN_NOTE)).toBeNull();
    expect(blockedPaymentTermsMessage("")).toBeNull();
    expect(blockedPaymentTermsMessage(null)).toBeNull();
    expect(blockedPaymentTermsMessage(undefined)).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(blockedPaymentTermsMessage("cod payment on delivery")).toContain("COD");
    expect(blockedPaymentTermsMessage("50 / 50 split")).toContain("50/50");
    expect(blockedPaymentTermsMessage("NET 7 please")).toContain("Net <days>");
  });
});

describe("save-layer notes guard — quote validation", () => {
  it("refuses a quote whose customer notes carry blocked payment phrases", () => {
    const parsed = quoteInputSchema.safeParse(quoteInput(BLOCKED_NOTE));
    expect(parsed.success).toBe(false);
    const issue = notesIssue(parsed);
    expect(issue).not.toBeNull();
    expect(issue!.message).toContain("Notes can't include payment terms");
  });

  it("accepts clean notes and stores them verbatim", () => {
    const parsed = quoteInputSchema.safeParse(quoteInput(CLEAN_NOTE));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.notes).toBe(CLEAN_NOTE);
  });

  it("does NOT guard staff-only internal notes (they never print)", () => {
    const parsed = quoteInputSchema.safeParse(quoteInput(CLEAN_NOTE, { internalNotes: "Customer insists on COD, 50/50 offered" }));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe("save-layer notes guard — sales order validation", () => {
  const soInput = (notes: string) => ({
    terms: "Net 30",
    notes,
    updatedAt: new Date().toISOString(),
    items: [item],
  });

  it("refuses an SO edit whose notes carry blocked payment phrases", () => {
    const parsed = salesOrderInputSchema.safeParse(soInput(BLOCKED_NOTE));
    expect(parsed.success).toBe(false);
    expect(notesIssue(parsed)!.message).toContain("Notes can't include payment terms");
  });

  it("accepts clean SO notes verbatim", () => {
    const parsed = salesOrderInputSchema.safeParse(soInput(CLEAN_NOTE));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.notes).toBe(CLEAN_NOTE);
  });
});

describe("save-layer notes guard — billing validation", () => {
  const billingInput = (notes: string) => ({
    salesOrderId: "so_1",
    amount: "1000.00",
    invoiceNo: 11,
    invoiceDate: "2026-11-23",
    dueDate: "2026-12-23",
    notes,
  });

  it("refuses a billing whose notes carry blocked payment phrases", () => {
    const parsed = billingInputSchema.safeParse(billingInput(BLOCKED_NOTE));
    expect(parsed.success).toBe(false);
    expect(notesIssue(parsed)!.message).toContain("Notes can't include payment terms");
  });

  it("accepts clean billing notes verbatim", () => {
    const parsed = billingInputSchema.safeParse(billingInput(CLEAN_NOTE));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.notes).toBe(CLEAN_NOTE);
  });
});
