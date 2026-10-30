// Books registers against MySQL 8 (TEST_DATABASE_URL). Read-only aggregates
// from billings, collections, supplier bills/payments, and expenses.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { money } from "@/lib/documents/common";
import { toScaled } from "@/lib/quotes/calc";
import { convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { recordSupplierPayment, voidSupplierPayment } from "@/lib/services/supplier-payments";
import { recordExpense, voidExpense } from "@/lib/services/expenses";
import { createCashAccount } from "@/lib/services/cash-accounts";
import { getBookRegister, listBookSourceRows } from "@/lib/services/books";
import { REGISTER_CONFIGS } from "@/lib/books/config";
import { sumMoney } from "@/lib/books/registers";
import { manilaYmdFromInstant } from "@/lib/books/period";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("books registers (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let viewer: DocActor;
  let invoiceSeq = 800_000 + Math.floor(Math.random() * 40_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-books-uploads-"));
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    await ensureWideBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Parallel suites also bump SettingsVersion — re-assert wide booklet before billings. */
  async function ensureWideBooklet() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      const booklet = snap.settings.invoiceBooklet;
      if (booklet.seriesFrom <= 1 && booklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1 + attempt,
            data: {
              ...snap.settings,
              invoiceBooklet: { seriesFrom: 1, seriesTo: 9_999_999, label: "Books test booklet" },
              features: { ...snap.settings.features, booksEnabled: true },
            } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: { seriesFrom: 1, seriesTo: 9_999_999, label: "Books test booklet" },
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // Unique version race with another suite — retry.
      }
    }
  }

  async function openSo(year: number) {
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
            supplierUnitCost: "80000",
            unitPrice: "100000",
          },
        ],
      },
      admin,
    );
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-BK-${tag()}`, deliveryAddress: "Manila" }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    return { customer, supplier, so, year };
  }

  it("view_books is enforced (Staff/Viewer forbidden)", async () => {
    await expect(listBookSourceRows(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listBookSourceRows(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await listBookSourceRows(admin);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("sales register totals equal source billings + collections; voids excluded", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    const { customer, so } = await openSo(year);
    const from = `${year}-03-01`;
    const to = `${year}-03-31`;

    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "10000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 10)),
        dueDate: new Date(Date.UTC(year, 3, 9)),
        notes: null,
      },
      admin,
    );
    const billingVoid = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "2000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 11)),
        dueDate: new Date(Date.UTC(year, 3, 10)),
        notes: null,
      },
      admin,
    );
    await voidBilling(billingVoid.id, "test void", admin);

    const collection = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 15)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-${tag()}`,
        amountReceived: "3000.50",
        notes: null,
        cashAccountId: null,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "3000.50",
            withholdingApplied: "0",
          },
        ],
      },
      admin,
    );
    const collectionVoid = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 16)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "100.00",
        notes: null,
        cashAccountId: null,
        allocations: [],
      },
      admin,
    );
    await voidCollection(collectionVoid.id, "void test", admin);

    const { register } = await getBookRegister(admin, "sales", from, to);
    const ours = register.rows.filter((r) => r.id === billing.id || r.id === collection.id);
    expect(ours).toHaveLength(2);
    expect(register.rows.some((r) => r.id === billingVoid.id)).toBe(false);
    expect(register.rows.some((r) => r.id === collectionVoid.id)).toBe(false);

    const expected = sumMoney([money(billing.amount), money(collection.amountReceived)]);
    const got = sumMoney(ours.map((r) => r.amount));
    expect(got).toBe(expected);
    expect(toScaled(got, 2)).toBe(toScaled("13000.50", 2));
  });

  it("PHT midnight boundaries: last day 23:59 in, next day 00:00 out (UTC-stored)", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    const { so } = await openSo(year);
    const lastDay = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "111.11",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 31)),
        dueDate: new Date(Date.UTC(year, 3, 30)),
        notes: null,
      },
      admin,
    );
    const nextDay = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "222.22",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 3, 1)),
        dueDate: new Date(Date.UTC(year, 4, 1)),
        notes: null,
      },
      admin,
    );

    const from = `${year}-03-01`;
    const to = `${year}-03-31`;
    expect(manilaYmdFromInstant(new Date(`${year}-03-31T15:59:00.000Z`))).toBe(`${year}-03-31`);
    expect(manilaYmdFromInstant(new Date(`${year}-03-31T16:00:00.000Z`))).toBe(`${year}-04-01`);

    const { register } = await getBookRegister(admin, "sales", from, to);
    const ids = new Set(register.rows.map((r) => r.id));
    expect(ids.has(lastDay.id)).toBe(true);
    expect(ids.has(nextDay.id)).toBe(false);

    const april = await getBookRegister(admin, "sales", `${year}-04-01`, `${year}-04-30`);
    const aprilIds = new Set(april.register.rows.map((r) => r.id));
    expect(aprilIds.has(nextDay.id)).toBe(true);
    expect(aprilIds.has(lastDay.id)).toBe(false);
  });

  it("disbursements + purchases + journal; no VAT fields; expense/payment voids excluded", async () => {
    const year = await freshYear();
    const supplier = await makeSupplier();
    const t = tag();

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
            description: "Widget",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            unitCost: "5000.00",
          },
        ],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, admin);
    await markPurchaseOrderSent(po.id, admin);
    const bill = await recordSupplierBill(
      po.id,
      {
        billNumber: `SB-${t}`,
        billDate: new Date(Date.UTC(year, 2, 5)),
        amount: "5000.00",
        notes: null,
        lines: [],
      },
      admin,
    );

    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 8)),
        method: "BANK_TRANSFER",
        reference: `REF-${t}`,
        checkBank: null,
        checkDate: null,
        amountPaid: "4500.00",
        notes: null,
        cashAccountId: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "4500.00",
            withholdingApplied: "500.00",
            withholdingRate: "0.1000",
            atcCode: "WI010",
          },
        ],
      },
      admin,
    );

    const account = await createCashAccount(
      {
        name: `Books cash ${t}`,
        type: "CASH_ON_HAND",
        bankName: null,
        accountHintLast4: null,
        openingBalance: "100000.00",
        openingDate: new Date(Date.UTC(year, 0, 1)),
        active: true,
      },
      admin,
    );
    let cats = await db.expenseCategory.findMany({ where: { active: true }, take: 1 });
    if (!cats.length) {
      await db.expenseCategory.create({
        data: { code: `UTIL_${t.slice(0, 6)}`, label: "Utilities", sortOrder: 1 },
      });
      cats = await db.expenseCategory.findMany({ where: { active: true }, take: 1 });
    }
    const expense = await recordExpense(
      {
        date: new Date(Date.UTC(year, 2, 12)),
        supplierId: null,
        payeeText: `Meralco ${t}`,
        categoryId: cats[0]!.id,
        amount: "750.25",
        withholdingApplied: "0",
        cashAccountId: account.id,
        receiptNo: null,
        notes: null,
      },
      admin,
      [],
    );
    const expenseVoid = await recordExpense(
      {
        date: new Date(Date.UTC(year, 2, 13)),
        supplierId: null,
        payeeText: `Void me ${t}`,
        categoryId: cats[0]!.id,
        amount: "99.00",
        withholdingApplied: "0",
        cashAccountId: account.id,
        receiptNo: null,
        notes: null,
      },
      admin,
      [],
    );
    await voidExpense(expenseVoid.id, "void", admin);

    const from = `${year}-03-01`;
    const to = `${year}-03-31`;

    const purchases = await getBookRegister(admin, "purchases", from, to);
    const purchaseRow = purchases.register.rows.find((r) => r.id === bill.id);
    expect(purchaseRow?.amount).toBe("5000.00");
    expect(REGISTER_CONFIGS.purchases.columns.some((c) => /vat/i.test(c.key) || /vat/i.test(c.label))).toBe(false);

    const disb = await getBookRegister(admin, "disbursements", from, to);
    const disbOurs = disb.register.rows.filter((r) => r.id === pay.id || r.id === expense.id);
    expect(disbOurs.some((r) => r.id === expenseVoid.id)).toBe(false);
    expect(sumMoney(disbOurs.map((r) => r.amount))).toBe(sumMoney(["4500.00", "750.25"]));

    await voidSupplierPayment(pay.id, "void pay", admin);
    const disbAfter = await getBookRegister(admin, "disbursements", from, to);
    expect(disbAfter.register.rows.some((r) => r.id === pay.id)).toBe(false);

    const journal = await getBookRegister(admin, "journal", from, to);
    expect(journal.register.rows.some((r) => r.id === bill.id)).toBe(true);
    expect(journal.register.rows.some((r) => r.id === expense.id)).toBe(true);
    for (const col of journal.config.columns) {
      expect(col.key.toLowerCase()).not.toMatch(/vat/);
      expect(col.label.toLowerCase()).not.toMatch(/vat|input tax/);
    }
  });
});
