import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-69: quote Terms tab — short terms (payment, delivery, supplier
// warranty, validity) filled from Settings and editable per quote, a
// Full terms line/QR to the website terms, a customer-facing Remarks
// box that prints, payment terms defaulting from the customer, and
// withholding + Contract price lines moved off this tab.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

function termsTab(src: string): string {
  const start = src.indexOf('{tab === "terms" && (');
  const end = src.indexOf('{tab === "notes"', start);
  return src.slice(start, end);
}

describe("S-69 quote Terms tab", () => {
  it("a NEW quote snapshots the Settings Delivery/Warranty defaults into its own fields (owner 2026-11-07)", () => {
    const newPage = read("src/app/(app)/quotes/new/page.tsx");
    expect(newPage).toContain("deliveryNotes: settings.print.deliveryNotes ?? \"\"");
    expect(newPage).toContain("warrantyNotes: settings.print.warrantyNotes ?? \"\"");
    // Existing quotes are NOT re-snapshotted: the edit page seeds the
    // editor's initial values from the quote's stored fields. (Its
    // printDefaults prop still carries the Settings text for display
    // fallback, so scope this check to the initial block.)
    const editPage = read("src/app/(app)/quotes/[id]/edit/page.tsx");
    const editInitial = editPage.slice(editPage.indexOf("initial={{"));
    expect(editInitial).toContain("deliveryNotes: quote.deliveryNotes ?? \"\"");
    expect(editInitial).toContain("warrantyNotes: quote.warrantyNotes ?? \"\"");
    expect(editInitial).not.toContain("settings.print.deliveryNotes");
    expect(editInitial).not.toContain("settings.print.warrantyNotes");
  });

  it("Delivery and Warranty are editable textareas, defaulting to Settings", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    const tab = termsTab(src);
    expect(tab).toContain('id="deliveryNotes"');
    expect(tab).toContain('id="warrantyNotes"');
    expect(tab).toContain("h.deliveryNotes || printDefaults.deliveryNotes");
    expect(tab).toContain("h.warrantyNotes || printDefaults.warrantyNotes");
    expect(tab).not.toContain("quote-readonly-block");
  });

  it("Terms tab has a Remarks box (the printing customer notes) and a Full terms line", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    const tab = termsTab(src);
    expect(tab).toContain('id="termsRemarks"');
    expect(tab).toContain("Prints on the quote");
    expect(tab).toContain("haciensolutions.com/policies");
  });

  it("withholding and Contract price lines are off the Terms tab", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    const tab = termsTab(src);
    expect(tab).not.toContain("Withholding (from lines)");
    expect(tab).not.toContain("totalsSummary");
  });

  it("payment terms still default from the customer on pick", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    expect(src).toContain("terms: c?.defaultTerms ?? h.terms");
  });

  it("per-quote delivery/warranty are validated, saved, viewed and printed", () => {
    const validation = read("src/lib/validation/quotes.ts");
    expect(validation).toContain("deliveryNotes: optionalText(1000)");
    expect(validation).toContain("warrantyNotes: optionalText(1000)");
    const service = read("src/lib/services/quotes.ts");
    expect(service).toContain("deliveryNotes: input.deliveryNotes ?? null");
    expect(service).toContain("warrantyNotes: input.warrantyNotes ?? null");
    const view = read("src/lib/quotes/views.ts");
    expect(view).toContain("deliveryNotes: q.deliveryNotes");
    const print = read("src/lib/print/views.ts");
    expect(print).toContain("q.deliveryNotes?.trim() ? q.deliveryNotes : letter.print.deliveryNotes");
    expect(print).toContain("q.warrantyNotes?.trim() ? q.warrantyNotes : letter.print.warrantyNotes");
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("deliveryNotes     String?     @db.Text");
    expect(schema).toContain("warrantyNotes     String?     @db.Text");
    const migration = read("prisma/migrations/20261104180000_s69_quote_terms/migration.sql");
    expect(migration).toContain("ADD COLUMN `deliveryNotes`");
    expect(migration).toContain("ADD COLUMN `warrantyNotes`");
  });
});
