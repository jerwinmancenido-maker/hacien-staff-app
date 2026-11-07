// Guard: the quote editor Terms tab collapses the empty Delivery/Warranty
// boxes behind an Add button, and shrinks the empty read-only Terms &
// conditions box to a one-line note (owner call 2026-11-08 — big empty boxes
// that print nothing are confusing). The fields themselves stay: they appear
// the moment text exists (quote's own or the Settings default) or on Add.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/docs/QuoteEditor.tsx", "utf8");

describe("quote Terms tab: empty Delivery/Warranty collapse", () => {
  it("tracks the open state and derives visibility from both text sources", () => {
    expect(src).toContain("const [termsNotesOpen, setTermsNotesOpen] = useState(false)");
    expect(src).toContain("h.deliveryNotes || printDefaults.deliveryNotes");
    expect(src).toContain("h.warrantyNotes || printDefaults.warrantyNotes");
    expect(src).toContain("const showDeliveryWarranty = termsNotesOpen || deliveryWarrantyText !== \"\"");
  });

  it("shows one quiet row with an Add button while both are empty", () => {
    expect(src).toContain("No delivery or warranty text for this quote.");
    expect(src).toContain("onClick={() => setTermsNotesOpen(true)}");
    expect(src).toContain("Add delivery / warranty");
  });

  it("keeps both textareas for when text exists or Add was clicked", () => {
    expect(src).toContain('id="deliveryNotes"');
    expect(src).toContain('id="warrantyNotes"');
    expect(src).toContain("{showDeliveryWarranty ? (");
  });

  it("shrinks the empty read-only Terms & conditions box to a one-line note", () => {
    expect(src).toContain("printDefaults.quoteTerms?.trim() ? (");
    expect(src).toContain("No standard terms set in Settings.");
  });
});
