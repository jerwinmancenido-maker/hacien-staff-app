// F37 (REQ-006 Block 9 J5, Jerwin's call 2026-11-20: WARN, don't refuse):
// money-out entries used to check only that the paying account exists and
// is active — a ₱999,999 transfer out of a ₱10,750 account saved silently.
// Now the services refuse an over-balance entry unless the caller passes
// allowOverBalance, and the form actions round-trip the same sentence as
// a soft warning (confirmOverBalance=1) before anything is saved.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally without it.

import { beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  process.env.CASH_ENABLED = "true";
  return { hasDb: !!url };
});

const actor = vi.hoisted(() => ({ user: null as unknown }));

vi.mock("@/lib/auth/current-user", () => ({
  requireActionPermission: async () => actor.user,
  requireUser: async () => actor.user,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { fundsWarningSentence } from "@/lib/cash/funds";
import { cashAccountBalance, createCashAccount, type CashActor } from "@/lib/services/cash-accounts";
import { recordCashTransfer } from "@/lib/services/cash-transfers";
import type { DocActor } from "@/lib/services/quotes";
import { recordExpense } from "@/lib/services/expenses";
import { approvePurchaseOrder, createStandalonePurchaseOrder, markPurchaseOrderSent } from "@/lib/services/purchase-orders";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { recordSupplierPayment, type PayablesActor } from "@/lib/services/supplier-payments";
import { recordCashTransferAction } from "@/app/(app)/cash/actions";
import { freshYear, makeSupplier, makeUser, paymentProof, tag } from "./fixtures";

const run = env.hasDb ? describe : describe.skip;

run("F37 over-balance funds guard (MySQL)", () => {
  let admin: CashActor & PayablesActor & DocActor;
  let categoryId: string;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-funds-uploads-"));
    process.env.CASH_ENABLED = "true";
    const user = await makeUser("costs");
    admin = user as CashActor & PayablesActor & DocActor;
    actor.user = user;
    const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!cat) throw new Error("ExpenseCategory seed missing — run migrations on TEST_DATABASE_URL.");
    categoryId = cat.id;
  });

  async function mkAccount(name: string, opening: string, year: number) {
    return createCashAccount(
      {
        name: `${name}-${tag()}`,
        type: "BANK",
        bankName: "Test Bank",
        accountHintLast4: "1234",
        openingBalance: opening,
        openingDate: new Date(Date.UTC(year, 0, 1)),
        active: true,
      },
      admin,
    );
  }

  async function openPayableBill(year: number, amount: string) {
    const supplier = await makeSupplier();
    const t = tag();
    const approver = await db.user.create({
      data: { email: `approver-f37-${t}@test.example.com`, name: `Approver F37 ${t}`, isApprover: true, canSeeCosts: true },
    });
    const po = await createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 1)),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", unitCost: amount }],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, approver as Parameters<typeof approvePurchaseOrder>[1]);
    await markPurchaseOrderSent(po.id, admin);
    const bill = await recordSupplierBill(
      po.id,
      { billNumber: `SI-F37-${tag()}`, billDate: new Date(Date.UTC(year, 2, 5)), amount, notes: null, lines: [] },
      admin,
    );
    return { supplier, bill };
  }

  it("sentence: exact figures for the J5 case; null when the entry fits or exactly equals the balance", () => {
    const s = fundsWarningSentence("Cash on hand", "10750.00", "999999.00", "transfer");
    expect(s).toContain("Cash on hand holds ₱10,750.00");
    expect(s).toContain("989,249.00");
    expect(s).toContain("Record anyway?");
    expect(fundsWarningSentence("Cash on hand", "10750.00", "100.00", "expense")).toBeNull();
    expect(fundsWarningSentence("Cash on hand", "10750.00", "10750.00", "payment")).toBeNull();
  });

  it("transfer: over balance refused without confirmation (nothing saved); saves with it and goes negative exactly", async () => {
    const year = await freshYear();
    const from = await mkAccount("F37From", "1000.00", year);
    const to = await mkAccount("F37To", "0.00", year);
    const before = await db.cashTransfer.count({ where: { fromAccountId: from.id } });

    await expect(
      recordCashTransfer(
        { date: new Date(Date.UTC(year, 2, 15)), fromAccountId: from.id, toAccountId: to.id, amount: "1500.00", notes: null },
        admin,
      ),
    ).rejects.toThrow(/holds ₱1,000\.00.*Record anyway\?/);
    expect(await db.cashTransfer.count({ where: { fromAccountId: from.id } })).toBe(before);
    expect(await cashAccountBalance(from.id)).toBe("1000.00");

    const saved = await recordCashTransfer(
      {
        date: new Date(Date.UTC(year, 2, 15)),
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: "1500.00",
        notes: null,
        allowOverBalance: true,
      },
      admin,
    );
    expect(saved.status).toBe("POSTED");
    expect(await cashAccountBalance(from.id)).toBe("-500.00");
    expect(await cashAccountBalance(to.id)).toBe("1500.00");

    // Under the (now negative) balance is impossible — but a fitting
    // transfer into the account still works, and a small one out of the
    // funded account needs no confirmation.
    await recordCashTransfer(
      { date: new Date(Date.UTC(year, 2, 16)), fromAccountId: to.id, toAccountId: from.id, amount: "100.00", notes: null },
      admin,
    );
    expect(await cashAccountBalance(from.id)).toBe("-400.00");
  });

  it("expense: over balance refused without confirmation; saves with it", async () => {
    const year = await freshYear();
    const account = await mkAccount("F37Exp", "300.00", year);
    const input = {
      date: new Date(Date.UTC(year, 2, 11)),
      supplierId: null,
      payeeText: "F37 payee",
      categoryId,
      amount: "450.00",
      withholdingApplied: "0",
      cashAccountId: account.id,
      receiptNo: null,
      notes: null,
    };
    await expect(recordExpense(input, admin)).rejects.toThrow(/this expense takes it to/);
    expect(await db.expense.count({ where: { cashAccountId: account.id } })).toBe(0);
    const saved = await recordExpense({ ...input, allowOverBalance: true }, admin);
    expect(saved.status).toBe("POSTED");
    expect(await cashAccountBalance(account.id)).toBe("-150.00");
  });

  it("supplier payment: over balance refused without confirmation; saves with it; unassigned payment never checked", async () => {
    const year = await freshYear();
    const account = await mkAccount("F37Pay", "2000.00", year);
    const { supplier, bill } = await openPayableBill(year, "10000.00");
    const input = {
      supplierId: supplier.id,
      date: new Date(Date.UTC(year, 2, 10)),
      method: "BANK_TRANSFER" as const,
      reference: "PAY-F37-1",
      checkBank: null,
      checkDate: null,
      amountPaid: "3000.00",
      notes: null,
      cashAccountId: account.id,
      allocations: [
        { supplierBillId: bill.id, cashApplied: "3000.00", withholdingApplied: "0", withholdingRate: "0.0000", atcCode: null },
      ],
    };
    await expect(recordSupplierPayment(input, admin, paymentProof)).rejects.toThrow(/this payment takes it to/);
    expect(await db.supplierPayment.count({ where: { cashAccountId: account.id } })).toBe(0);

    const saved = await recordSupplierPayment({ ...input, allowOverBalance: true }, admin, paymentProof);
    expect(saved.status).toBe("POSTED");
    expect(await cashAccountBalance(account.id)).toBe("-1000.00");

    // No cash account assigned → the funds guard does not apply at all.
    // (bill2 sits with its own supplier — the payment must name that supplier.)
    const { supplier: supplier2, bill: bill2 } = await openPayableBill(year, "5000.00");
    const unassigned = await recordSupplierPayment(
      {
        ...input,
        supplierId: supplier2.id,
        reference: "PAY-F37-2",
        cashAccountId: null,
        allocations: [
          { supplierBillId: bill2.id, cashApplied: "3000.00", withholdingApplied: "0", withholdingRate: "0.0000", atcCode: null },
        ],
      },
      admin,
      paymentProof,
    );
    expect(unassigned.status).toBe("POSTED");
  });

  it("action: transfer form round-trips the warning and saves nothing until confirmed (the J5 flow)", async () => {
    const year = await freshYear();
    const from = await mkAccount("F37ActFrom", "10750.00", year);
    const to = await mkAccount("F37ActTo", "0.00", year);
    const form = (confirm: boolean) => {
      const fd = new FormData();
      fd.set("date", `${year}-03-15`);
      fd.set("fromAccountId", from.id);
      fd.set("toAccountId", to.id);
      fd.set("amount", "999999.00");
      fd.set("notes", "");
      if (confirm) fd.set("confirmOverBalance", "1");
      return fd;
    };

    const warned = await recordCashTransferAction({}, form(false));
    expect(warned.ok).toBeUndefined();
    expect(warned.warning).toContain("holds ₱10,750.00");
    expect(warned.warning).toContain("989,249.00");
    expect(await db.cashTransfer.count({ where: { fromAccountId: from.id } })).toBe(0);

    const saved = await recordCashTransferAction({}, form(true));
    expect(saved.ok).toBe(true);
    expect(await db.cashTransfer.count({ where: { fromAccountId: from.id } })).toBe(1);
    expect(await cashAccountBalance(from.id)).toBe("-989249.00");
  });
});
