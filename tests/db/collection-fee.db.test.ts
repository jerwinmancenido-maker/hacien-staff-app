// Collection fee capture (REQ-COLLECTION-FEES-001). Runs on MySQL 8
// (TEST_DATABASE_URL); skipped locally. Proves, against the real
// services: cash lands net of the fee, the fee posts as an expense
// linked to the sale, the Billing row is never written by a fee
// collection, invalid fees record nothing, a fee-less collection
// behaves exactly as before, and voiding reverses the fee.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.CASH_ENABLED = "true";
  const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { money } from "@/lib/documents/common";
import { getSettingsSnapshot } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import { cashAccountBalance, createCashAccount } from "@/lib/services/cash-accounts";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput, tag } from "./fixtures";

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet collection fee" };
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
          createdById: adminId,
        },
      });
      return;
    } catch {
      // Unique version race with another suite — retry.
    }
  }
}

describe.skipIf(!env.hasDb)("collection fee capture (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 0;

  async function nextInvoice(): Promise<number> {
    if (invoiceSeq === 0) {
      const [maxBilling, maxSpoiled, maxClaim] = await Promise.all([
        db.billing.aggregate({ _max: { invoiceNo: true } }),
        db.spoiledBookletNumber.aggregate({ _max: { number: true }, where: { type: "SI" } }),
        db.bookletSerialClaim.aggregate({ _max: { number: true }, where: { type: "SI" } }),
      ]);
      const maxUsed = Math.max(
        880_000,
        Number(maxBilling._max.invoiceNo ?? 0),
        Number(maxSpoiled._max.number ?? 0),
        Number(maxClaim._max.number ?? 0),
      );
      invoiceSeq = maxUsed + Math.floor(Math.random() * 500) + 1;
    }
    for (let attempt = 0; attempt < 500; attempt++) {
      const candidate = ++invoiceSeq;
      const [takenBilling, spoiled, takenClaim] = await Promise.all([
        db.billing.findFirst({ where: { invoiceNo: candidate }, select: { id: true } }),
        db.spoiledBookletNumber.findFirst({ where: { type: "SI", number: candidate }, select: { id: true } }),
        db.bookletSerialClaim.findFirst({ where: { type: "SI", number: candidate }, select: { number: true } }),
      ]);
      if (!takenBilling && !spoiled && !takenClaim) return candidate;
    }
    throw new Error("Could not allocate unused SI number after 500 attempts");
  }

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-collfee-uploads-"));
    admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeAccount() {
    return createCashAccount(
      {
        name: `Fee account-${tag()}`,
        type: "BANK",
        bankName: "Test Bank",
        accountHintLast4: "1234",
        openingBalance: "0.00",
        openingDate: new Date(Date.UTC(2026, 0, 1)),
        active: true,
      },
      admin,
    );
  }

  async function makeOpenBilling(year: number) {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Widget A",
            kind: "GOODS",
            qty: "1",
            unit: "pc",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "1000",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddressId }, admin);
    for (let attempt = 0; attempt < 5; attempt++) {
      const invoiceNo = await nextInvoice();
      try {
        const billing = await recordBilling(
          {
            salesOrderId: so.id,
            amount: "1000.00",
            invoiceNo,
            invoiceDate: new Date(),
            dueDate: new Date(),
            notes: null,
          },
          admin,
        );
        return { customer, so, billing };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already used|spoiled/i.test(msg) && attempt < 4) continue;
        throw err;
      }
    }
    throw new Error("Failed to record billing: unable to allocate unused SI number after retries");
  }

  function collectionInput(
    customerId: string,
    extra: Record<string, unknown> = {},
  ): Parameters<typeof recordCollection>[0] {
    return {
      customerId,
      date: new Date(),
      method: "GCASH",
      reference: "FEE-REF-1",
      checkBank: null,
      checkDate: null,
      receiptNo: null,
      amountReceived: "300.00",
      notes: null,
      allocations: [],
      ...extra,
    } as Parameters<typeof recordCollection>[0];
  }

  it("cash lands net, the fee posts as an SO-linked expense, and the Billing row is byte-identical", async () => {
    const year = await freshYear();
    const { customer, so, billing } = await makeOpenBilling(year);
    const account = await makeAccount();

    // A first, fee-less partial collection puts the billing into
    // PARTIALLY_PAID. A later collection that keeps that status makes
    // recomputeBillingStatus write nothing — so any Billing change
    // after this point could only come from the fee path itself.
    await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "400.00",
        cashAccountId: account.id,
        allocations: [{ billingId: billing.id, cashApplied: "400.00", withholdingApplied: "0.00" }],
      }),
      admin,
    );
    expect(await cashAccountBalance(account.id)).toBe("400.00");
    const billingBefore = JSON.stringify(
      await db.billing.findUniqueOrThrow({ where: { id: billing.id } }),
    );

    const feeCollection = await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "300.00",
        feeAmount: "25.00",
        cashAccountId: account.id,
        allocations: [{ billingId: billing.id, cashApplied: "300.00", withholdingApplied: "0.00" }],
      }),
      admin,
    );

    // (a) Cash lands net: +300 collected, −25 fee expense = 675 total.
    expect(await cashAccountBalance(account.id)).toBe("675.00");

    // (b) The Billing row is byte-identical — the fee never touched it.
    const billingAfter = JSON.stringify(
      await db.billing.findUniqueOrThrow({ where: { id: billing.id } }),
    );
    expect(billingAfter).toBe(billingBefore);

    // The billing still settles by the full collected amounts (700 of 1000).
    const allocs = await db.collectionAllocation.findMany({ where: { billingId: billing.id } });
    const cashApplied = allocs.reduce((a, x) => a + Number(x.cashApplied), 0);
    expect(cashApplied).toBe(700);

    // (a2) The fee expense: amount, SO link, account, fingerprint notes.
    const stored = await db.collection.findUniqueOrThrow({ where: { id: feeCollection.id } });
    expect(money(stored.feeAmount)).toBe("25.00");
    expect(stored.feeExpenseId).toBeTruthy();
    const expense = await db.expense.findUniqueOrThrow({ where: { id: stored.feeExpenseId! } });
    expect(money(expense.amount)).toBe("25.00");
    expect(expense.salesOrderId).toBe(so.id);
    expect(expense.cashAccountId).toBe(account.id);
    expect(expense.status).toBe("POSTED");
    expect(expense.notes).toBe(
      `Collection fee withheld from collection - collection ${feeCollection.number}, billing ${billing.number}.`,
    );
  });

  it("a fee above the amount collected is refused and records nothing", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year);
    const collectionsBefore = await db.collection.count({ where: { customerId: customer.id } });
    const expensesBefore = await db.expense.count();
    await expect(
      recordCollection(
        collectionInput(customer.id, {
          amountReceived: "300.00",
          feeAmount: "300.01",
          allocations: [{ billingId: billing.id, cashApplied: "300.00", withholdingApplied: "0.00" }],
        }),
        admin,
      ),
    ).rejects.toThrow(/can't be more than the amount received/);
    expect(await db.collection.count({ where: { customerId: customer.id } })).toBe(collectionsBefore);
    expect(await db.expense.count()).toBe(expensesBefore);
  });

  it("a negative fee is refused", async () => {
    const year = await freshYear();
    const { customer } = await makeOpenBilling(year);
    await expect(
      recordCollection(collectionInput(customer.id, { feeAmount: "-1.00" }), admin),
    ).rejects.toThrow(/can't be negative/);
  });

  it("a collection with no fee behaves exactly as before: no expense, full amount lands", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year);
    const account = await makeAccount();
    const col = await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "300.00",
        cashAccountId: account.id,
        allocations: [{ billingId: billing.id, cashApplied: "300.00", withholdingApplied: "0.00" }],
      }),
      admin,
    );
    const stored = await db.collection.findUniqueOrThrow({ where: { id: col.id } });
    expect(money(stored.feeAmount)).toBe("0.00");
    expect(stored.feeExpenseId).toBeNull();
    expect(await db.expense.count({ where: { salesOrderId: billing.salesOrderId } })).toBe(0);
    expect(await cashAccountBalance(account.id)).toBe("300.00");
  });

  it("voiding a fee-bearing collection voids the fee expense and un-lands the fee", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year);
    const account = await makeAccount();
    const col = await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "500.00",
        feeAmount: "40.00",
        cashAccountId: account.id,
        allocations: [{ billingId: billing.id, cashApplied: "500.00", withholdingApplied: "0.00" }],
      }),
      admin,
    );
    expect(await cashAccountBalance(account.id)).toBe("460.00");
    const stored = await db.collection.findUniqueOrThrow({ where: { id: col.id } });
    const expenseId = stored.feeExpenseId!;

    await voidCollection(col.id, "Recorded against the wrong payment.", admin);

    const after = await db.collection.findUniqueOrThrow({ where: { id: col.id } });
    expect(after.status).toBe("VOID");
    const expense = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
    expect(expense.status).toBe("VOID");
    expect(expense.voidReason).toContain(`Voided with collection ${col.number}`);
    // Collection and fee both VOID → the account is back to its opening 0.
    expect(await cashAccountBalance(account.id)).toBe("0.00");
    // The billing reopens (its only collection is void).
    const billingAfter = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(billingAfter.status).toBe("OPEN");
  });
});
