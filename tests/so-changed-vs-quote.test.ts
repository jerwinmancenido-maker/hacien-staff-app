// Part A markers pair 1 — the pure "Changed vs quote" comparison + the UI
// wiring pins. The db-side proof (convert stamps quoteItemId; the view
// surfaces changes) lives in tests/db/so-changed-markers.db.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changedSummary, lineChangesVsQuote, type QuoteLineSnapshot } from "@/lib/quotes/changed";

const quote: QuoteLineSnapshot = { qty: "10.00", unitPrice: "1200.00", kind: "GOODS", withholdingRate: "0.0100", withholdingAtc: "WI010" };
const same = { ...quote };

describe("lineChangesVsQuote", () => {
  it("no change → no marker", () => {
    expect(lineChangesVsQuote(same, quote)).toEqual([]);
    // Formatting-only differences are not changes ("10" vs "10.00").
    expect(lineChangesVsQuote({ ...quote, qty: "10", unitPrice: "1200" }, quote)).toEqual([]);
  });

  it("qty and price changes read plainly", () => {
    const changes = lineChangesVsQuote({ ...quote, qty: "12.00", unitPrice: "1150.00" }, quote);
    expect(changes.map((c) => c.label)).toEqual(["qty 10.00 → 12.00", "price ₱1,200.00 → ₱1,150.00"]);
  });

  it("kind and withholding changes are marked", () => {
    expect(lineChangesVsQuote({ ...quote, kind: "SERVICES" }, quote).map((c) => c.field)).toEqual(["kind"]);
    expect(lineChangesVsQuote({ ...quote, withholdingRate: "0.0200" }, quote).map((c) => c.field)).toEqual(["withholding"]);
    expect(lineChangesVsQuote({ ...quote, withholdingAtc: "WC020" }, quote).map((c) => c.field)).toEqual(["withholding"]);
    // A null rate on both sides with the same ATC is not a change.
    expect(lineChangesVsQuote({ ...quote, withholdingRate: null }, { ...quote, withholdingRate: null })).toEqual([]);
  });

  it("summary matches the approved shape", () => {
    expect(changedSummary({ ...quote, qty: "12.00", unitPrice: "1150.00", unit: "pcs" }, { ...quote, unit: "pcs" })).toBe(
      "Quote: 10.00 pcs @ ₱1,200.00, now 12.00 pcs @ ₱1,150.00",
    );
  });
});

describe("marker wiring", () => {
  it("conversion stamps the quote line id on every SO line", () => {
    const quotes = readFileSync("src/lib/services/quotes.ts", "utf8");
    expect(quotes).toContain("quoteItemId: i.id");
  });

  it("the SO view computes markers from quoteItemId and counts changed lines", () => {
    const views = readFileSync("src/lib/quotes/views.ts", "utf8");
    expect(views).toContain("lineChangesVsQuote");
    expect(views).toContain("changedLineCount");
    expect(views).toContain("soLineOrderedQty");
  });

  it("the overview shows the tag, the differences and the summary line", () => {
    const parts = readFileSync("src/components/docs/DocParts.tsx", "utf8");
    expect(parts).toContain(">Changed</span> vs quote:");
    const page = readFileSync("src/app/(app)/sales-orders/[id]/page.tsx", "utf8");
    expect(page).toContain("changed from quote");
  });

  it("the SO editor shows the per-line notes without PO numbers (A7)", () => {
    const editor = readFileSync("src/components/docs/DocumentEditor.tsx", "utf8");
    expect(editor).toContain("Already on a PO");
    expect(editor).toContain("Delivered ");
    const page = readFileSync("src/app/(app)/sales-orders/[id]/edit/page.tsx", "utf8");
    expect(page).toContain("orderedQty: orderedByLine.get(i.id)");
  });
});
