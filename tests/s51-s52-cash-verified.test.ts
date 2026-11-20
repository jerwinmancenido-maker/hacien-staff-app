// S-51 + S-52, verified 2026-11-04: both already exist in the cash module
// (built before the board went stale), so no feature code was added here.
// These tests lock the verified behaviour in place.
// - S-51: expenses originally carried no PO link (superseded 2026-11-14 by
//   Phase 4 #7: Expense gains OPTIONAL salesOrderId / purchaseOrderId links
//   per Jerwin's D3 decision — delivery fee = expense linked to the order;
//   a null link keeps the original S-51 behaviour exactly); a petty cash
//   fund is a CASH_ON_HAND account (hint says so), topped up by a transfer
//   from the bank.
// - S-52: /cash shows balances by account across cash on hand, bank, e-wallet.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CASH_ACCOUNT_TYPE_HINTS } from "@/lib/cash/labels";

const src = (p: string) => readFileSync(p, "utf8");

describe("S-51 expenses without a PO + petty cash fund", () => {
  it("Expense order links are optional (Phase 4 #7 supersedes the no-link rule)", () => {
    const schema = src("prisma/schema.prisma");
    const expense = schema.slice(schema.indexOf("model Expense {"), schema.indexOf("model CashTransfer {"));
    expect(expense).toContain("purchaseOrderId");
    expect(expense).toContain("salesOrderId");
    expect(expense).toContain("cashAccountId");
    expect(expense).toContain("categoryId");
  });

  it("a petty cash fund is a cash-on-hand account, topped up by transfer", () => {
    expect(CASH_ACCOUNT_TYPE_HINTS.CASH_ON_HAND).toContain("Petty cash");
    expect(src("src/components/cash/AccountForm.tsx")).toContain("Petty cash");
    expect(src("prisma/schema.prisma")).toContain("model CashTransfer {");
  });
});

describe("S-52 cash and bank view", () => {
  it("cash home shows balances by account across the three types", () => {
    const page = src("src/app/(app)/cash/page.tsx");
    expect(page).toContain("Balances by account");
    expect(page).toContain("cashPositionSummary");
    expect(src("src/lib/cash/labels.ts")).toContain('BANK: "Bank account"');
    expect(src("src/lib/cash/labels.ts")).toContain('E_WALLET: "E-wallet"');
    // UnionBank / GCash are account names staff create, not hardcoded types.
    expect(src("src/lib/cash/labels.ts")).toContain("GCash");
  });
});
