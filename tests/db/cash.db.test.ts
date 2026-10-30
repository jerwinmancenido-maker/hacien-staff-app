// Cash accounts, expenses, transfers, and account-linked collections/payments
// against MySQL 8 (TEST_DATABASE_URL). Requires CASH_ENABLED for mutations.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  // Suite runs with cash ON; individual tests flip CASH_ENABLED=false when needed.
  process.env.CASH_ENABLED = "true";
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { CASH_OFF_MESSAGE } from "@/lib/cash/features";
import { DocRuleError } from "@/lib/documents/common";
import { ForbiddenError } from "@/lib/permissions";
import { toScaled } from "@/lib/quotes/calc";
import { getSettingsSnapshot } from "@/lib/settings";
import { cashAccountBalance, createCashAccount, type CashActor } from "@/lib/services/cash-accounts";
import { recordCashTransfer, voidCashTransfer } from "@/lib/services/cash-transfers";
import { recordExpense, voidExpense } from "@/lib/services/expenses";
import { convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { recordSupplierPayment, voidSupplierPayment, type PayablesActor } from "@/lib/services/supplier-payments";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("cash accounts / expenses / transfers (MySQL)", () => {
  let admin: CashActor & DocActor & PayablesActor;
  let staff: DocActor;
  let categoryId: string;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-cash-uploads-"));
    process.env.CASH_ENABLED = "true";
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
    const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!cat) throw new Error("ExpenseCategory seed missing — run migrations on TEST_DATABASE_URL.");
    categoryId = cat.id;
  });

  afterAll(async () => {
    process.env.CASH_ENABLED = "true";
    await db.$disconnect();
  });

  let invoiceSeq = 800_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  /** Parallel suites can republish settings with the default 1–500 booklet. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet cash" };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.invoiceBooklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1,
            data: { ...(latest.data as object), invoiceBooklet: wide } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: wide,
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // Unique version race with another suite — retry.
      }
    }
  }

  async function mkAccount(name: string, opening = "10000.00", openingDate = new Date(Date.UTC(2026, 0, 1))) {
    return createCashAccount(
      {
        name: `${name}-${tag()}`,
        type: "BANK",
        bankName: "Test Bank",
        accountHintLast4: "1234",
        openingBalance: opening,
        openingDate,
        active: true,
      },
      admin,
    );
  }

  async function openSoBilling(year: number, unitPrice = "5000.00") {
    await ensureWideBooklet();
    const customer = await makeCustomer(["GOODS_1"]);
    const supplier = await makeSupplier();
    const rate = await db.withholdingRate.findUnique({ where: { code: "GOODS_1" } });
    if (!rate) {
      await db.withholdingRate.create({
        data: { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS", atcCode: "WC010", rate: "0.0100", sortOrder: 1 },
      });
    }
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          {
            id: null,
            description: "Goods",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "4000",
            unitPrice,
          },
        ],
      },
      admin,
    );
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-CASH", deliveryAddress: "Manila" }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: unitPrice,
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    return { customer, so, billing };
  }

  async function openPayableBill(year: number, amount: string) {
    const supplier = await makeSupplier();
    const t = tag();
    const approver = await db.user.create({
      data: {
        email: `approver-cash-${t}@test.example.com`,
        name: `Approver cash ${t}`,
        isApprover: true,
        canSeeCosts: true,
      },
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
        items: [
          {
            id: null,
            description: "Goods",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            unitCost: amount,
          },
        ],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, approver);
    await markPurchaseOrderSent(po.id, admin);
    const bill = await recordSupplierBill(
      po.id,
      {
        billNumber: `SI-CASH-${tag()}`,
        billDate: new Date(Date.UTC(year, 2, 5)),
        amount,
        notes: null,
        lines: [],
      },
      admin,
    );
    return { supplier, bill };
  }

  it("CASH_ENABLED=off rejects cash mutations and cashAccountId on collection/payment", async () => {
    const year = await freshYear();
    const account = await mkAccount("Gate");
    process.env.CASH_ENABLED = "false";
    try {
      await expect(
        createCashAccount(
          {
            name: `Off-${tag()}`,
            type: "CASH_ON_HAND",
            bankName: null,
            accountHintLast4: null,
            openingBalance: "0.00",
            openingDate: new Date(Date.UTC(year, 0, 1)),
            active: true,
          },
          admin,
        ),
      ).rejects.toThrow(CASH_OFF_MESSAGE);

      await expect(
        recordExpense(
          {
            date: new Date(Date.UTC(year, 2, 10)),
            supplierId: null,
            payeeText: "Office supply",
            categoryId,
            amount: "100.00",
            withholdingApplied: "0",
            cashAccountId: account.id,
            receiptNo: null,
            notes: null,
          },
          admin,
        ),
      ).rejects.toThrow(CASH_OFF_MESSAGE);

      const { customer, billing } = await openSoBilling(year, "1000.00");
      await expect(
        recordCollection(
          {
            customerId: customer.id,
            date: new Date(Date.UTC(year, 2, 6)),
            method: "CASH",
            reference: null,
            checkBank: null,
            checkDate: null,
            receiptNo: "OR-OFF-1",
            amountReceived: "500.00",
            notes: null,
            cashAccountId: account.id,
            allocations: [
              { billingId: billing.id, cashApplied: "500.00", withholdingApplied: "0.00" },
            ],
          },
          admin,
        ),
      ).rejects.toThrow(/Cash is turned off/i);

      const { supplier, bill } = await openPayableBill(year, "2000.00");
      await expect(
        recordSupplierPayment(
          {
            supplierId: supplier.id,
            date: new Date(Date.UTC(year, 2, 10)),
            method: "CASH",
            reference: null,
            checkBank: null,
            checkDate: null,
            amountPaid: "500.00",
            notes: null,
            cashAccountId: account.id,
            allocations: [
              {
                supplierBillId: bill.id,
                cashApplied: "500.00",
                withholdingApplied: "0",
                withholdingRate: "0.0000",
                atcCode: null,
              },
            ],
          },
          admin,
        ),
      ).rejects.toThrow(/Cash is turned off/i);
    } finally {
      process.env.CASH_ENABLED = "true";
    }
  });

  it("expense void restores account balance; staff cannot record", async () => {
    const year = await freshYear();
    const account = await mkAccount("Exp", "5000.00", new Date(Date.UTC(year, 0, 1)));
    expect(await cashAccountBalance(account.id)).toBe("5000.00");

    await expect(
      recordExpense(
        {
          date: new Date(Date.UTC(year, 2, 10)),
          supplierId: null,
          payeeText: "Staff blocked",
          categoryId,
          amount: "10.00",
          withholdingApplied: "0",
          cashAccountId: account.id,
          receiptNo: null,
          notes: null,
        },
        staff,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const exp = await recordExpense(
      {
        date: new Date(Date.UTC(year, 2, 10)),
        supplierId: null,
        payeeText: "Courier",
        categoryId,
        amount: "250.50",
        withholdingApplied: "0",
        cashAccountId: account.id,
        receiptNo: "OR-E1",
        notes: null,
      },
      admin,
    );
    expect(await cashAccountBalance(account.id)).toBe("4749.50");

    await voidExpense(exp.id, "Wrong payee — reverse", admin);
    expect(await cashAccountBalance(account.id)).toBe("5000.00");
    expect((await db.expense.findUniqueOrThrow({ where: { id: exp.id } })).status).toBe("VOID");
  });

  it("transfer void restores both account balances; concurrent transfers get unique numbers", async () => {
    const year = await freshYear();
    const from = await mkAccount("From", "8000.00", new Date(Date.UTC(year, 0, 1)));
    const to = await mkAccount("To", "1000.00", new Date(Date.UTC(year, 0, 1)));

    const tr = await recordCashTransfer(
      {
        date: new Date(Date.UTC(year, 2, 15)),
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: "500.00",
        notes: null,
      },
      admin,
    );
    expect(await cashAccountBalance(from.id)).toBe("7500.00");
    expect(await cashAccountBalance(to.id)).toBe("1500.00");

    await voidCashTransfer(tr.id, "Wrong accounts", admin);
    expect(await cashAccountBalance(from.id)).toBe("8000.00");
    expect(await cashAccountBalance(to.id)).toBe("1000.00");

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        recordCashTransfer(
          {
            date: new Date(Date.UTC(year, 2, 16)),
            fromAccountId: from.id,
            toAccountId: to.id,
            amount: "10.00",
            notes: null,
          },
          admin,
        ),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(3);
    const numbers = new Set(
      (ok as PromiseFulfilledResult<{ number: string }>[]).map((r) => r.value.number),
    );
    expect(numbers.size).toBe(3);
  });

  it("concurrent expenses get unique EXP numbers and all debit the account", async () => {
    const year = await freshYear();
    const account = await mkAccount("ConcExp", "1000.00", new Date(Date.UTC(year, 0, 1)));
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) =>
        recordExpense(
          {
            date: new Date(Date.UTC(year, 2, 10)),
            supplierId: null,
            payeeText: `Payee ${i}`,
            categoryId,
            amount: "100.00",
            withholdingApplied: "0",
            cashAccountId: account.id,
            receiptNo: null,
            notes: null,
          },
          admin,
        ),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(3);
    const numbers = new Set(
      (ok as PromiseFulfilledResult<{ number: string }>[]).map((r) => r.value.number),
    );
    expect(numbers.size).toBe(3);
    expect(await cashAccountBalance(account.id)).toBe("700.00");
  });

  it("account-linked collection: balance rises; void restores; concurrent allocations still capped", async () => {
    const year = await freshYear();
    const account = await mkAccount("Coll", "0.00", new Date(Date.UTC(year, 0, 1)));
    const { customer, billing } = await openSoBilling(year, "1000.00");

    const col = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "BANK_TRANSFER",
        reference: "REF-CASH-1",
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-CASH-1",
        amountReceived: "400.00",
        notes: null,
        cashAccountId: account.id,
        allocations: [
          { billingId: billing.id, cashApplied: "400.00", withholdingApplied: "0.00" },
        ],
      },
      admin,
    );
    expect(await cashAccountBalance(account.id)).toBe("400.00");

    await voidCollection(col.id, "Reverse deposit", admin);
    expect(await cashAccountBalance(account.id)).toBe("0.00");

    // Billing still has full 1000 open (prior collection voided). Race three 600 allocations.
    const mk = (receiptNo: string) =>
      recordCollection(
        {
          customerId: customer.id,
          date: new Date(Date.UTC(year, 2, 8)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          receiptNo,
          amountReceived: "600.00",
          notes: null,
          cashAccountId: account.id,
          allocations: [
            { billingId: billing.id, cashApplied: "600.00", withholdingApplied: "0.00" },
          ],
        },
        admin,
      );
    const results = await Promise.allSettled([mk("OR-CONC-C1"), mk("OR-CONC-C2"), mk("OR-CONC-C3")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(2);
    for (const r of bad) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(DocRuleError);
    }
    const bal = await cashAccountBalance(account.id);
    expect(toScaled(bal, 2)).toBe(toScaled("600.00", 2));
  });

  it("account-linked supplier payment: balance drops; void restores; concurrent payments capped", async () => {
    const year = await freshYear();
    const account = await mkAccount("Pay", "20000.00", new Date(Date.UTC(year, 0, 1)));
    const { supplier, bill } = await openPayableBill(year, "10000.00");

    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "BANK_TRANSFER",
        reference: "PAY-CASH-1",
        checkBank: null,
        checkDate: null,
        amountPaid: "3000.00",
        notes: null,
        cashAccountId: account.id,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "3000.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect(await cashAccountBalance(account.id)).toBe("17000.00");
    await voidSupplierPayment(pay.id, "Wrong amount", admin);
    expect(await cashAccountBalance(account.id)).toBe("20000.00");

    const mk = (ref: string) =>
      recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 11)),
          method: "BANK_TRANSFER",
          reference: ref,
          checkBank: null,
          checkDate: null,
          amountPaid: "6000.00",
          notes: null,
          cashAccountId: account.id,
          allocations: [
            {
              supplierBillId: bill.id,
              cashApplied: "6000.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        admin,
      );
    const results = await Promise.allSettled([mk("CONC-P-A"), mk("CONC-P-B"), mk("CONC-P-C")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    // Bill is 10000; each tries 6000 → one wins, then remaining 4000 so second may also fail.
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(2);
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PARTIALLY_PAID");
    expect(await cashAccountBalance(account.id)).toBe("14000.00");
  });
});
