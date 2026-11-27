// Account-less expenses (Gap 7 follow-up) against MySQL 8
// (TEST_DATABASE_URL): the consumer census for the Expense.cashAccountId
// widening, proven leg by leg -
//   * the cash position (total, unassigned net, per-account balances)
//     is unchanged to the centavo with an account-less expense present;
//   * the unassigned ledger and every account ledger exclude it (the
//     money never moved through cash);
//   * expense/profit reporting INCLUDES it (a real absorbed cost);
//   * listExpenses returns it with a null account (the views render
//     that as "Not assigned");
//   * voidExpense works on it (Slice 3 refund mirror depends on it).

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  process.env.CASH_ENABLED = "true";
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { cashPositionSummary, ledgerEntriesForAccount } from "@/lib/services/cash-accounts";
import { listExpenses, voidExpense } from "@/lib/services/expenses";
import { getMonthlyProfit } from "@/lib/services/profit";
import { makeUser, tag } from "./fixtures";

async function makeAccountlessExpense(actorId: string, categoryId: string, amount: string, date: Date, t: string) {
  return db.expense.create({
    data: {
      number: `EXP-ACCTLESS-${t}`,
      date,
      payeeText: "TestPay",
      categoryId,
      amount,
      withholdingApplied: "0",
      cashAccountId: null,
      createdById: actorId,
    },
  });
}

async function anActiveCategoryId(): Promise<string> {
  const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  if (!cat) throw new Error("ExpenseCategory seed missing - run migrations on TEST_DATABASE_URL.");
  return cat.id;
}

describe("account-less expenses (Gap 7 census)", () => {
  it("counts in profit reporting but touches no cash figure", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t = tag();
    const categoryId = await anActiveCategoryId();
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));

    const positionBefore = await cashPositionSummary();
    const profitBefore = await getMonthlyProfit(month);

    const expense = await makeAccountlessExpense(admin.id, categoryId, "123.45", date, t);
    expect(expense.cashAccountId).toBeNull();
    expect(expense.status).toBe("POSTED");

    // Cash position: identical to the centavo - total, unassigned net,
    // and every account balance.
    const positionAfter = await cashPositionSummary();
    expect(positionAfter.total).toBe(positionBefore.total);
    expect(positionAfter.unassignedNet).toBe(positionBefore.unassignedNet);
    expect(positionAfter.accounts.map((a) => [a.id, a.balance])).toEqual(
      positionBefore.accounts.map((a) => [a.id, a.balance]),
    );

    // Ledgers: the unassigned ledger carries no expense rows at all,
    // and no account ledger carries this one.
    const unassigned = await ledgerEntriesForAccount(null);
    expect(unassigned.some((e) => e.kind === "EXPENSE")).toBe(false);
    expect(unassigned.some((e) => e.id === expense.id)).toBe(false);
    for (const a of positionBefore.accounts) {
      const entries = await ledgerEntriesForAccount(a.id);
      expect(entries.some((e) => e.id === expense.id)).toBe(false);
    }

    // Profit reporting includes it, to the centavo.
    const profitAfter = await getMonthlyProfit(month);
    expect(Number(profitAfter.expenses) - Number(profitBefore.expenses)).toBeCloseTo(123.45, 2);

    // The Expenses list returns it with a null account (the views
    // render that as Not assigned).
    const listed = await listExpenses({ status: "ALL", q: expense.number });
    const row = listed.find((e) => e.id === expense.id);
    expect(row).toBeDefined();
    expect(row!.cashAccount).toBeNull();
  });

  it("voids like any other expense (Slice 3 refund mirror seam)", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t = tag();
    const categoryId = await anActiveCategoryId();
    const future = new Date();
    future.setUTCMonth(future.getUTCMonth() + 2);
    const date = new Date(Date.UTC(future.getUTCFullYear(), future.getUTCMonth(), 15));
    const expense = await makeAccountlessExpense(admin.id, categoryId, "55.00", date, t);
    const voided = await voidExpense(expense.id, "Gap 7 census void check", admin);
    expect(voided.status).toBe("VOID");
    const snap = await db.documentVoid.findFirst({ where: { docType: "EXPENSE", docId: expense.id } });
    expect(snap).not.toBeNull();
  });
});
