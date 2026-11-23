import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the collection print "Applied to" line (found in the 2026-11-08
// print review, Batch 15): billing numbers already carry their "BL-" prefix
// (e.g. "BL-2026-0001"), so the print view must not prepend another "BL " —
// the staging print rendered "BL BL-2026-0001 / booklet #1".
const views = readFileSync(join(process.cwd(), "src/lib/print/views.ts"), "utf8");

describe("collection print — Applied to references", () => {
  it("does not hard-code a BL prefix before the billing number", () => {
    expect(views).not.toContain("`BL ${a.billing.number}");
    expect(views).not.toContain('"BL " +');
  });

  it("still builds the reference from the billing number and booklet no.", () => {
    // The booklet number carries its standardized name (2026-11-21).
    expect(views).toContain("${a.billing.number} / Sales Invoice No. ${formatBookletNumber(a.billing.invoiceNo)}");
  });
});

// VR1 Client F4: the acknowledgement printed the internal cash-account
// name ("Deposited to: BDO Ops") — a bookkeeping label the customer
// cannot act on — and omitted the sales-order / buyer-PO references the
// billing print carries, breaking the customer's filing chain.
describe("collection print — customer filing references, no internal account name", () => {
  const start = views.indexOf("export async function getCollectionPrintModel");
  const model = views.slice(start, views.indexOf("export async function getPurchaseOrderPrintModel", start));

  it("never prints the internal cash-account name", () => {
    expect(model).not.toContain("Deposited to");
    expect(model).not.toContain("cashAccount");
  });

  it("loads the sales order and buyer PO through the allocations", () => {
    expect(model).toContain("salesOrder: { select: { number: true, buyerPoNo: true } }");
  });

  it("carries the Sales order and Customer PO/ref meta cells, like the billing print", () => {
    expect(model).toContain('{ label: "Sales order", value: soRefs.join(", ") }');
    expect(model).toContain('{ label: "Customer PO/ref", value: poRefs.join(", ") }');
  });

  it("leaves the EWT-applied line exactly as established", () => {
    expect(model).toContain('"EWT (2307) applied"');
    expect(model).toContain("EWT_2307_NOTE");
  });
});
