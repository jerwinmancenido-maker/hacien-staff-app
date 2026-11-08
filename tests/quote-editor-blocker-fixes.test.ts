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
  it("Pick a customer… precedes + Add new customer in the customer select", () => {
    const start = editor.indexOf('id="customerId"');
    expect(start).toBeGreaterThan(-1);
    const block = editor.slice(start, start + 500);
    const placeholder = block.indexOf('<option value="">Pick a customer…</option>');
    const add = block.indexOf('<option value="__add__">+ Add new customer</option>');
    expect(placeholder).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(-1);
    expect(placeholder).toBeLessThan(add);
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
