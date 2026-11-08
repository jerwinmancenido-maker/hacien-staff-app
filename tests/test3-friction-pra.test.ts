import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// PR-A guards (test-3 friction plan, 2026-11-08): the Add Customer dialog's
// withholding field is labelled for what it is, and the PO Receiving tab
// carries its own Receive items entry point (same gate as the Actions menu).
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const dialog = read("src/components/docs/AddCustomerDialog.tsx");
const poPage = read("src/app/(app)/purchase-orders/[id]/page.tsx");
const quotePage = read("src/app/(app)/quotes/[id]/page.tsx");

describe("Add Customer dialog withholding label", () => {
  it("the acq-type field is labelled Withholding, not Type", () => {
    const start = dialog.indexOf('htmlFor="acq-type"');
    expect(start).toBeGreaterThan(-1);
    const block = dialog.slice(start, start + 120);
    expect(block).toContain("Withholding");
    expect(block).not.toContain(">Type<");
  });
});

describe("PO receiving tab receive entry point", () => {
  it("links to /receiving/<id>/new behind the SENT/PARTIALLY_RECEIVED + canEdit gate", () => {
    const start = poPage.indexOf('tab === "receiving"');
    expect(start).toBeGreaterThan(-1);
    const block = poPage.slice(start, start + 900);
    expect(block).toContain("Receive items");
    expect(block).toContain("/receiving/${id}/new");
    expect(block).toContain('po.status === "SENT"');
    expect(block).toContain('po.status === "PARTIALLY_RECEIVED"');
    expect(block).toContain("canEdit");
  });
});

describe("quote record header chip rule is wired", () => {
  it("the status chip renders through quoteHeaderShowsStatusChip", () => {
    expect(quotePage).toContain("quoteHeaderShowsStatusChip(q.status, q.approvalStatus)");
  });
});
