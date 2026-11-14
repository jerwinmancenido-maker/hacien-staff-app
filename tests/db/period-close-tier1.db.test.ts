// Phase 4 #10 step 2: Tier 1 period guards — one db test per guarded
// path (14 points; the credit point covers BOTH apply functions)
// against MySQL 8 (TEST_DATABASE_URL).
//
// Pattern per path: fixtures dated in the path's OWN past month (each
// test closes a distinct month, so tests never close each other out),
// the path succeeds while the month is open, closePeriod (real service,
// Admin actor) closes it, the same call then rejects with the
// closed-period message ("is closed") and no partial write lands, and
// a record dated in a different OPEN month still posts. PeriodLock rows
// created here are REOPENED in afterAll (and pre-cleaned in beforeAll) —
// the app's no-delete extension forbids deleteMany, and a reopened row
// closes again cleanly, so reruns on the same test DB pass.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  process.env.CASH_ENABLED = "true";
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { createCashAccount, type CashActor } from "@/lib/services/cash-accounts";
import { recordBilling, updateBilling, voidBilling } from "@/lib/services/billings";
import {
  applyCreditSimple,
  applyCustomerCredit,
  recordCollection,
  voidCollection,
} from "@/lib/services/collections";
import { recordCashTransfer, voidCashTransfer } from "@/lib/services/cash-transfers";
import { recordExpense, voidExpense } from "@/lib/services/expenses";
import { closePeriod, reopenPeriod } from "@/lib/services/period-close";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordSupplierBill, voidSupplierBill } from "@/lib/services/supplier-bills";
import {
  recordSupplierPayment as recordSupplierPaymentRaw,
  voidSupplierPayment,
  type PayablesActor,
} from "@/lib/services/supplier-payments";
import { customerDeliveryAddressId, makeCustomer, makeSupplier, makeUser, paymentProof, tag } from "./fixtures";

function recordSupplierPayment(
  input: Parameters<typeof recordSupplierPaymentRaw>[0],
  actor: Parameters<typeof recordSupplierPaymentRaw>[1],
) {
  return recordSupplierPaymentRaw(input, actor, paymentProof);
}

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const plusDays = (date: Date, n: number) => new Date(date.getTime() + n * 86_400_000);

/** Every month this file closes — cleaned up so reruns start open. */
const CLOSED_MONTHS = [
  "2024-01", "2024-03", "2024-05", "2024-06", "2024-08", "2024-09", "2024-11",
  "2025-01", "2025-03", "2025-04", "2025-06", "2025-07", "2025-09", "2025-10", "2025-12",
];

describe.skipIf(!env.hasDb)("period close Tier 1 guards (MySQL)", () => {
  let admin: CashActor & DocActor & PayablesActor;
  let approver: PayablesActor;
  let categoryId: string;
  let expenseAccountId: string;
  let transferFromId: string;
  let transferToId: string;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-period-close-uploads-"));
    process.env.CASH_ENABLED = "true";
    admin = await makeUser("costs");
    const t = tag();
    approver = await db.user.create({
      data: { email: `approver-pc-${t}@test.example.com`, name: `Approver PC ${t}`, isApprover: true, canSeeCosts: true },
    });
    const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!cat) throw new Error("ExpenseCategory seed missing — run migrations on TEST_DATABASE_URL.");
    categoryId = cat.id;
    await reopenAll();
    const mkAcct = (name: string) =>
      createCashAccount(
        {
          name: `${name}-${tag()}`,
          type: "BANK",
          bankName: "Test Bank",
          accountHintLast4: "1234",
          openingBalance: "100000.00",
          openingDate: d(2023, 1, 1),
          active: true,
        },
        admin,
      );
    expenseAccountId = (await mkAcct("PCExpense")).id;
    transferFromId = (await mkAcct("PCFrom")).id;
    transferToId = (await mkAcct("PCTo")).id;
  });

  /** Reopen every month this file closed (no hard deletes in this app). */
  async function reopenAll() {
    for (const ym of CLOSED_MONTHS) {
      try {
        await reopenPeriod(ym, "Test cleanup — reopen after period-close suite", admin);
      } catch {
        // Not closed (test failed before closing, or a rerun pre-clean) — fine.
      }
    }
  }

  afterAll(async () => {
    await reopenAll();
    await db.$disconnect();
  });

  let invoiceSeq = 900_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  /** Parallel suites can republish settings with the default 1–500 booklet. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet period close" };
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

  async function makeSo(date: Date, customerId?: string) {
    await ensureWideBooklet();
    const customer = customerId
      ? await db.customer.findUniqueOrThrow({ where: { id: customerId }, include: { contacts: true } })
      : await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date,
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: supplier.id, supplierUnitCost: "80000", unitPrice: "100000" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-PC", deliveryAddressId }, admin, {
      date: plusDays(date, 1),
    });
    return { customer, so };
  }

  function billingInput(soId: string, invoiceDate: Date, amount = "1000.00") {
    return {
      salesOrderId: soId,
      amount,
      invoiceNo: nextInvoice(),
      invoiceDate,
      dueDate: plusDays(invoiceDate, 30),
      notes: null as string | null,
    };
  }

  function collectionInput(customerId: string, date: Date, amount = "1000.00") {
    return {
      customerId,
      date,
      method: "CASH" as const,
      reference: null as string | null,
      checkBank: null as string | null,
      checkDate: null as Date | null,
      receiptNo: null as string | null,
      amountReceived: amount,
      notes: null as string | null,
      allocations: [] as never[],
    };
  }

  async function makePoBill(supplierId: string, billDate: Date, amount = "1000.00") {
    const po = await createStandalonePurchaseOrder(
      {
        supplierId,
        supplierContactId: null,
        date: plusDays(billDate, -4),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", unitCost: amount }],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, approver);
    await markPurchaseOrderSent(po.id, admin);
    const bill = await recordSupplierBill(
      po.id,
      { billNumber: `INV-PC-${tag()}`, billDate, amount, notes: null, lines: [] },
      admin,
    );
    return { po, bill };
  }

  function supplierPaymentInput(supplierId: string, billId: string, date: Date, amount = "1000.00") {
    return {
      supplierId,
      date,
      method: "CASH" as const,
      reference: null as string | null,
      checkBank: null as string | null,
      checkDate: null as Date | null,
      amountPaid: amount,
      notes: null as string | null,
      allocations: [
        { supplierBillId: billId, cashApplied: amount, withholdingApplied: "0", withholdingRate: "0.0000", atcCode: null as string | null },
      ],
    };
  }

  function expenseInput(date: Date, payeeText: string) {
    return {
      date,
      supplierId: null,
      payeeText,
      categoryId,
      amount: "350.00",
      withholdingApplied: "0",
      cashAccountId: expenseAccountId,
      receiptNo: null,
      notes: null,
    } as Parameters<typeof recordExpense>[0];
  }

  // 1 — recordBilling: invoiceDate
  it("recordBilling refuses a closed invoice month; an open month still posts", async () => {
    const { so } = await makeSo(d(2024, 1, 2));
    const first = await recordBilling(billingInput(so.id, d(2024, 1, 10)), admin);
    expect(first.status).toBe("OPEN");
    await closePeriod("2024-01", admin);
    const before = await db.billing.count({ where: { salesOrderId: so.id } });
    await expect(recordBilling(billingInput(so.id, d(2024, 1, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.billing.count({ where: { salesOrderId: so.id } })).toBe(before);
    const other = await recordBilling(billingInput(so.id, d(2024, 2, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 2 — updateBilling: OLD and NEW invoiceDate
  it("updateBilling refuses when either the old or the new invoice month is closed", async () => {
    const a = await makeSo(d(2024, 3, 2));
    const billingClosed = await recordBilling(billingInput(a.so.id, d(2024, 3, 10)), admin);
    const b = await makeSo(d(2024, 4, 2));
    const billingOpen = await recordBilling(billingInput(b.so.id, d(2024, 4, 10)), admin);
    await closePeriod("2024-03", admin);

    const edit = (id: string, orig: { invoiceNo: number }, invoiceDate: Date) =>
      updateBilling(id, { amount: "1000.00", invoiceNo: orig.invoiceNo, invoiceDate, dueDate: plusDays(invoiceDate, 30), notes: null }, admin);

    // Both months open: the edit lands.
    const moved = await edit(billingOpen.id, billingOpen, d(2024, 4, 20));
    expect(moved.invoiceDate.toISOString().slice(0, 10)).toBe("2024-04-20");
    // Old month closed (new month open): refused, date unchanged.
    await expect(edit(billingClosed.id, billingClosed, d(2024, 4, 15))).rejects.toThrow(/is closed/);
    expect((await db.billing.findUniqueOrThrow({ where: { id: billingClosed.id } })).invoiceDate.toISOString().slice(0, 10)).toBe("2024-03-10");
    // New month closed (old month open): refused, date unchanged.
    await expect(edit(billingOpen.id, billingOpen, d(2024, 3, 15))).rejects.toThrow(/is closed/);
    expect((await db.billing.findUniqueOrThrow({ where: { id: billingOpen.id } })).invoiceDate.toISOString().slice(0, 10)).toBe("2024-04-20");
  });

  // 3 — voidBilling: stored invoiceDate
  it("voidBilling refuses a billing dated in a closed month", async () => {
    const { so } = await makeSo(d(2024, 5, 2));
    const billing = await recordBilling(billingInput(so.id, d(2024, 5, 10)), admin);
    await closePeriod("2024-05", admin);
    await expect(voidBilling(billing.id, "Wrong entry — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.billing.findUniqueOrThrow({ where: { id: billing.id } })).status).not.toBe("VOID");
  });

  // 4 — recordCollection: date
  it("recordCollection refuses a closed month; an open month still posts", async () => {
    const customer = await makeCustomer();
    const first = await recordCollection(collectionInput(customer.id, d(2024, 6, 10)), admin);
    expect(first.status).toBe("POSTED");
    await closePeriod("2024-06", admin);
    const before = await db.collection.count({ where: { customerId: customer.id } });
    await expect(recordCollection(collectionInput(customer.id, d(2024, 6, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.collection.count({ where: { customerId: customer.id } })).toBe(before);
    const other = await recordCollection(collectionInput(customer.id, d(2024, 7, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 5 — voidCollection: stored date
  it("voidCollection refuses a collection dated in a closed month", async () => {
    const customer = await makeCustomer();
    const col = await recordCollection(collectionInput(customer.id, d(2024, 8, 10)), admin);
    await closePeriod("2024-08", admin);
    await expect(voidCollection(col.id, "Wrong entry — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.collection.findUniqueOrThrow({ where: { id: col.id } })).status).toBe("POSTED");
  });

  // 6 — applyCustomerCredit: collection date AND each target billing's invoiceDate
  it("applyCustomerCredit refuses when either the collection or the target billing month is closed", async () => {
    const { customer, so } = await makeSo(d(2024, 9, 2));
    const billingClosed = await recordBilling(billingInput(so.id, d(2024, 9, 10), "10000.00"), admin);
    const billingOpen = await recordBilling(billingInput(so.id, d(2024, 10, 10), "10000.00"), admin);
    const colClosed = await recordCollection(collectionInput(customer.id, d(2024, 9, 5)), admin);
    const colOpen = await recordCollection(collectionInput(customer.id, d(2024, 10, 5)), admin);
    const apply = (collectionId: string, billingId: string) =>
      applyCustomerCredit(
        { customerId: customer.id, allocations: [{ collectionId, billingId, cashApplied: "100.00", withholdingApplied: "0" }] },
        admin,
      );
    // While open, the same apply lands.
    await apply(colOpen.id, billingOpen.id);
    await closePeriod("2024-09", admin);
    const allocCount = () =>
      db.collectionAllocation.count({ where: { collectionId: { in: [colClosed.id, colOpen.id] } } });
    const before = await allocCount();
    // Collection end closed (billing open).
    await expect(apply(colClosed.id, billingOpen.id)).rejects.toThrow(/is closed/);
    // Billing end closed (collection open).
    await expect(apply(colOpen.id, billingClosed.id)).rejects.toThrow(/is closed/);
    expect(await allocCount()).toBe(before);
    // Open-to-open still applies after the close.
    await apply(colOpen.id, billingOpen.id);
    expect(await allocCount()).toBe(before + 1);
  });

  // 6b — applyCreditSimple: same double-end rule, FIFO sources
  it("applyCreditSimple refuses when either the source collection or the target billing month is closed", async () => {
    const a = await makeSo(d(2024, 11, 2));
    const billingOpenA = await recordBilling(billingInput(a.so.id, d(2024, 12, 10), "10000.00"), admin);
    await recordCollection(collectionInput(a.customer.id, d(2024, 11, 5)), admin);
    const b = await makeSo(d(2024, 11, 2));
    const billingClosedB = await recordBilling(billingInput(b.so.id, d(2024, 11, 10), "10000.00"), admin);
    await recordCollection(collectionInput(b.customer.id, d(2024, 12, 5)), admin);
    // While open, the same apply lands (customer A, from its Nov collection).
    await applyCreditSimple(a.customer.id, billingOpenA.id, "100.00", admin);
    await closePeriod("2024-11", admin);
    const allocsFor = (billingId: string) => db.collectionAllocation.count({ where: { billingId } });
    const beforeA = await allocsFor(billingOpenA.id);
    const beforeB = await allocsFor(billingClosedB.id);
    // Source collection end closed (billing open).
    await expect(applyCreditSimple(a.customer.id, billingOpenA.id, "100.00", admin)).rejects.toThrow(/is closed/);
    // Billing end closed (source collection open).
    await expect(applyCreditSimple(b.customer.id, billingClosedB.id, "100.00", admin)).rejects.toThrow(/is closed/);
    expect(await allocsFor(billingOpenA.id)).toBe(beforeA);
    expect(await allocsFor(billingClosedB.id)).toBe(beforeB);
  });

  // 7 — recordSupplierBill: billDate
  it("recordSupplierBill refuses a closed bill month; an open month still posts", async () => {
    const supplier = await makeSupplier();
    const first = await makePoBill(supplier.id, d(2025, 1, 10));
    expect(first.bill.id).toBeTruthy();
    await closePeriod("2025-01", admin);
    const po2 = await createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: d(2025, 1, 6),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", unitCost: "1000.00" }],
      },
      admin,
    );
    await approvePurchaseOrder(po2.id, approver);
    await markPurchaseOrderSent(po2.id, admin);
    await expect(
      recordSupplierBill(po2.id, { billNumber: `INV-PC-${tag()}`, billDate: d(2025, 1, 15), amount: "1000.00", notes: null, lines: [] }, admin),
    ).rejects.toThrow(/is closed/);
    expect(await db.supplierBill.count({ where: { purchaseOrderId: po2.id } })).toBe(0);
    const other = await makePoBill(supplier.id, d(2025, 2, 10));
    expect(other.bill.id).toBeTruthy();
  });

  // 8 — voidSupplierBill: stored billDate
  it("voidSupplierBill refuses a bill dated in a closed month", async () => {
    const supplier = await makeSupplier();
    const { bill } = await makePoBill(supplier.id, d(2025, 3, 10));
    await closePeriod("2025-03", admin);
    await expect(voidSupplierBill(bill.id, "Wrong bill — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).not.toBe("VOID");
  });

  // 9 — recordSupplierPayment: date
  it("recordSupplierPayment refuses a closed month; an open month still posts", async () => {
    const supplier = await makeSupplier();
    const billDate = d(2025, 2, 5); // open month (never closed in this file), distinct from the closed payment month
    const b1 = await makePoBill(supplier.id, billDate);
    const b2 = await makePoBill(supplier.id, billDate);
    const b3 = await makePoBill(supplier.id, billDate);
    const first = await recordSupplierPayment(supplierPaymentInput(supplier.id, b1.bill.id, d(2025, 4, 10)), admin);
    expect(first.status).toBe("POSTED");
    await closePeriod("2025-04", admin);
    const before = await db.supplierPayment.count({ where: { supplierId: supplier.id } });
    await expect(recordSupplierPayment(supplierPaymentInput(supplier.id, b2.bill.id, d(2025, 4, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.supplierPayment.count({ where: { supplierId: supplier.id } })).toBe(before);
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: b2.bill.id } })).status).not.toBe("PAID");
    const other = await recordSupplierPayment(supplierPaymentInput(supplier.id, b3.bill.id, d(2025, 5, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 10 — voidSupplierPayment: stored date
  it("voidSupplierPayment refuses a payment dated in a closed month", async () => {
    const supplier = await makeSupplier();
    const { bill } = await makePoBill(supplier.id, d(2025, 2, 5));
    const pay = await recordSupplierPayment(supplierPaymentInput(supplier.id, bill.id, d(2025, 6, 10)), admin);
    await closePeriod("2025-06", admin);
    await expect(voidSupplierPayment(pay.id, "Wrong payment — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.supplierPayment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("POSTED");
  });

  // 11 — recordExpense: date
  it("recordExpense refuses a closed month; an open month still posts", async () => {
    const payee = `PCExp ${tag()}`;
    const first = await recordExpense(expenseInput(d(2025, 7, 10), payee), admin);
    expect(first.status).toBe("POSTED");
    await closePeriod("2025-07", admin);
    const payee2 = `PCExp ${tag()}`;
    await expect(recordExpense(expenseInput(d(2025, 7, 15), payee2), admin)).rejects.toThrow(/is closed/);
    expect(await db.expense.count({ where: { payeeText: payee2 } })).toBe(0);
    const other = await recordExpense(expenseInput(d(2025, 8, 10), payee2), admin);
    expect(other.id).toBeTruthy();
  });

  // 12 — voidExpense: stored date
  it("voidExpense refuses an expense dated in a closed month", async () => {
    const exp = await recordExpense(expenseInput(d(2025, 9, 10), `PCExp ${tag()}`), admin);
    await closePeriod("2025-09", admin);
    await expect(voidExpense(exp.id, "Wrong expense — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.expense.findUniqueOrThrow({ where: { id: exp.id } })).status).toBe("POSTED");
  });

  // 13 — recordCashTransfer: date
  it("recordCashTransfer refuses a closed month; an open month still posts", async () => {
    const input = (date: Date) => ({ date, fromAccountId: transferFromId, toAccountId: transferToId, amount: "100.00", notes: null as string | null });
    const first = await recordCashTransfer(input(d(2025, 10, 10)), admin);
    expect(first.status).toBe("POSTED");
    await closePeriod("2025-10", admin);
    const before = await db.cashTransfer.count({ where: { fromAccountId: transferFromId } });
    await expect(recordCashTransfer(input(d(2025, 10, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.cashTransfer.count({ where: { fromAccountId: transferFromId } })).toBe(before);
    const other = await recordCashTransfer(input(d(2025, 11, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 14 — voidCashTransfer: stored date
  it("voidCashTransfer refuses a transfer dated in a closed month", async () => {
    const tr = await recordCashTransfer(
      { date: d(2025, 12, 10), fromAccountId: transferFromId, toAccountId: transferToId, amount: "100.00", notes: null },
      admin,
    );
    await closePeriod("2025-12", admin);
    await expect(voidCashTransfer(tr.id, "Wrong transfer — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.cashTransfer.findUniqueOrThrow({ where: { id: tr.id } })).status).toBe("POSTED");
  });
});
