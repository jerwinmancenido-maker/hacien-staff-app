import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { taxFooterLines } from "@/lib/print/tax-wording";

// S-87: print a billing statement from the SO. The billing print already
// exists (/print/billings/[id], title BILLING STATEMENT, booklet invoice
// no., "not an official invoice" footer) — this task only adds the links
// to reach it from the SO. It must NOT print a sales invoice: the official
// invoice is the BIR pre-printed booklet.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-87 print billing statement from the SO", () => {
  it("SO Actions menu has one Print billing statement entry per billing, opening the billing print in a new tab", () => {
    const src = read("src/components/docs/QuoteActions.tsx");
    expect(src).toContain("Print billing statement");
    expect(src).toContain("`/print/billings/${b.id}`");
    expect(src).toContain("newTab: true");
    // No entry when there are no billings (default []), so nothing dead to print.
    expect(src).toContain("billings = []");
  });

  it("SO page passes its billings to the Actions menu", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(src).toContain("billings={billings.map((b) => ({ id: b.id, number: b.number }))}");
  });

  it("SO Billing card has a Print link per billing, desktop table and phone list", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(src).toContain("<th>Print</th>");
    expect(src.match(/href={`\/print\/billings\/\$\{b\.id\}`}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('target="_blank"');
  });

  it("the billing print reached by those links is a statement, not an invoice", () => {
    const model = read("src/lib/print/views.ts");
    expect(model).toContain('title: "BILLING STATEMENT"');
    expect(model).toContain('label: "Booklet invoice no."');
    // Footer: billing prints carry "This is not an official invoice/receipt".
    expect(taxFooterLines("billing")).toContain("This is not an official invoice/receipt");
    // And no sales-invoice print route is linked from the SO page.
    const so = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(so).not.toContain("/print/invoices/");
  });
});
