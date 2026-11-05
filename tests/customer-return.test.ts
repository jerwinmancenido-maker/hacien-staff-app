import { checkCustomerReturn } from "@/lib/sales-orders/returns";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Audit D: customer return / credit memo. A return records goods back,
// reduces deliveredQty, and creates customer credit for the returned value
// (qty x SO unit price) that can be applied to an open billing.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("checkCustomerReturn", () => {
  const lines = [{ id: "l1", description: "Widget A", deliveredQty: "2.00" }];

  it("accepts a return up to what was delivered", () => {
    expect(checkCustomerReturn(lines, [{ lineId: "l1", qty: "2" }])).toEqual({
      ok: true,
      entries: [{ lineId: "l1", qty: "2.00" }],
    });
  });

  it("refuses more than was delivered", () => {
    const r = checkCustomerReturn(lines, [{ lineId: "l1", qty: "3" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["l1"]).toMatch(/Only 2 delivered/);
  });

  it("refuses an empty return", () => {
    expect(checkCustomerReturn(lines, [{ lineId: "l1", qty: "" }]).ok).toBe(false);
  });

  it("refuses a line that is not on the order", () => {
    const r = checkCustomerReturn(lines, [{ lineId: "nope", qty: "1" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["nope"]).toMatch(/isn't on the sales order/);
  });
});

describe("Audit D wiring", () => {
  it("the return service reduces deliveredQty, creates credit, and reopens a closed SO", () => {
    const src = read("src/lib/services/customer-returns.ts");
    expect(src).toContain("applyDelivery(line, e.qty, -1)");
    expect(src).toContain("credit: { create:");
    expect(src).toContain("refreshSalesOrderCloseState");
  });

  it("voiding a return reverses applied credit and restores quantities", () => {
    const src = read("src/lib/services/customer-returns.ts");
    // No hard delete (repo rule): the application rows stay, but every
    // balance sum only counts POSTED returns, so voiding un-applies.
    expect(src).not.toContain("deleteMany");
    expect(src).toContain("applyDelivery(line, money(String(item.qtyReturned)), 1)");
    expect(read("src/lib/services/billings.ts")).toContain('customerReturn: { status: "POSTED" }');
  });

  it("billing balances include return-credit applications", () => {
    expect(read("src/lib/services/billings.ts")).toContain("customerCreditApplication");
    expect(read("src/lib/billing/views.ts")).toContain("creditApplications");
  });

  it("the statement shows credit memos as their own line", () => {
    expect(read("src/lib/billing/views.ts")).toContain('kind: "credit"');
    expect(read("src/lib/print/views.ts")).toContain("Credit memo");
  });

  it("a billing with return credit applied cannot be voided", () => {
    expect(read("src/lib/services/billings.ts")).toContain("Void the credit memo first");
  });

  it("the simple credit apply draws FIFO across collections and return credit", () => {
    const src = read("src/lib/services/collections.ts");
    expect(src).toContain("applyCreditSimple");
    expect(src).toContain('kind: "credit"');
  });
});
