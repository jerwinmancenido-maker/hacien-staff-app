import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// In-quote flow blocker fixes (Jerwin's staging blocker hunt, 2026-11-08):
// (1) comma-grouped costs misread as missing — behavior covered in
// quotes-calc.test.ts; (2) the customer select listed "+ Add new customer"
// before the placeholder, so the resting display WAS the add option and
// choosing it fired no change (dead first click); (3) catalog items created
// from a quote line did not carry the line's price as their default.
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const editor = read("src/components/docs/QuoteEditor.tsx");
const quotesService = read("src/lib/services/quotes.ts");
const calc = read("src/lib/quotes/calc.ts");

describe("customer select placeholder comes first", () => {
  it("the select holds only the placeholder + customers; adding is a visible button", () => {
    // Updated 2026-11-08 (add-entry-points PR-1): the in-dropdown add option
    // was buried at the top of the native popup once a customer was picked,
    // so the create action moved to an "Add customer" button beside the
    // select. The placeholder still comes first; no __add__ option remains.
    const start = editor.indexOf('id="customerId"');
    expect(start).toBeGreaterThan(-1);
    const block = editor.slice(start, start + 700);
    expect(block).toContain('<option value="">Pick a customer…</option>');
    expect(block).not.toContain('value="__add__"');
    expect(block).toContain("Add customer");
    expect(block).toContain("setAddCustomerOpen(true)");
  });
});

describe("blocker fix wiring", () => {
  it("supplierCostMissing strips thousands commas before the decimal test", () => {
    const start = calc.indexOf("export function supplierCostMissing");
    const body = calc.slice(start, start + 400);
    expect(body).toContain('replace(/,/g, "")');
  });

  it("catalog items created from a quote line carry the line price as default", () => {
    const start = quotesService.indexOf("async function resolveNewCatalogItems");
    const body = quotesService.slice(start, start + 1600);
    expect(body).toContain("defaultUnitPrice: input.unitPrice");
  });
});
