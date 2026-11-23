import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// VR1 Procurement F3: the buyer's PO number was nowhere on the quotation
// print. The print slot existed end to end, but in the normal flow the
// number arrives at conversion and is stored on the sales order only —
// the quote record stays null, so every reprint omitted it. The quote
// print model now falls back to the converted order's number (print
// only; no stored data changes).
const views = readFileSync(join(process.cwd(), "src/lib/print/views.ts"), "utf8");
const start = views.indexOf("export async function getQuotePrintModel");
const model = views.slice(start, views.indexOf("export async function getSalesOrderPrintModel", start));

describe("quote print — buyer PO reference", () => {
  it("falls back to the converted sales order's buyer PO number", () => {
    expect(model).toContain(
      "db.salesOrder.findFirst({ where: { quoteId: q.id }, select: { buyerPoNo: true } })",
    );
  });

  it("feeds the existing Customer PO / RFQ no. meta slot from the fallback", () => {
    expect(model).toContain('...(buyerPoNo ? [{ label: "Customer PO / RFQ no.", value: buyerPoNo }] : [])');
    expect(model).not.toContain("value: q.buyerPoNo");
  });
});
