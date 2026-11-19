// Business entities (Reconciliation Plan 2026-11-19, PR-B): the money wall.
// Documents tagged to another business never enter HACIEN's Books
// registers, monthly profit, or supplier-EWT worksheet — and they are
// summarised by getHeldForOthers so the bank still reconciles.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { saveBusiness } from "@/lib/services/businesses";
import { recordBilling } from "@/lib/services/billings";
import { getHeldForOthers, listBookSourceRows } from "@/lib/services/books";
import { createCashAccount, type CashActor } from "@/lib/services/cash-accounts";
import { recordExpense } from "@/lib/services/expenses";
import { getMonthlyProfit } from "@/lib/services/profit";
import { createPurchaseOrdersFromSalesOrder, markPurchaseOrderSent } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { recordSupplierPayment as recordSupplierPaymentRaw } from "@/lib/services/supplier-payments";
import { getSupplierEwtWorksheet } from "@/lib/services/tax-worksheets";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, paymentProof, tag } from "./fixtures";

function recordSupplierPayment(
  input: Parameters<typeof recordSupplierPaymentRaw>[0],
  actor: Parameters<typeof recordSupplierPaymentRaw>[1],
) {
  return recordSupplierPaymentRaw(input, actor, paymentProof);
}

describe.skipIf(!env.hasDb)("business entity money wall (MySQL)", () => {
  let admin: DocActor & CashActor;
  let categoryId: string;
  let accountId: string;
  let invoiceSeq = 850_000 + Math.floor(Math.random() * 40_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-bizwall-uploads-"));
    process.env.CASH_ENABLED = "true";
    admin = await makeUser("costs");
    const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!cat) throw new Error("ExpenseCategory seed missing — run migrations on TEST_DATABASE_URL.");
    categoryId = cat.id;
    const year = await freshYear();
    const account = await createCashAccount(
      {
        name: `WallAcct-${tag()}`,
        type: "BANK",
        bankName: "Test Bank",
        accountHintLast4: "1234",
        openingBalance: "100000.00",
        openingDate: new Date(Date.UTC(year, 0, 1)),
        active: true,
      },
      admin,
    );
    accountId = account.id;
    await ensureWideBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet bizwall" };
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

  /** Quote (tagged or not) → SO → PO for the quote's supplier. March dates. */
  async function makeChain(year: number, businessId: string | null) {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        businessId,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: supplier.id, supplierUnitCost: "4000", unitPrice: "10000" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-WALL-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const items = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      {
        date: new Date(Date.UTC(year, 2, 3)),
        expectedDate: null,
        deliveryAddressText: null,
        supplierPicks: {},
        idempotencyKey: `wall-${year}-${tag()}`.slice(0, 64),
        rows: [{ key: items[0]!.id, supplierId: supplier.id, qty: "1" }],
      },
      admin,
    );
    return { customer, supplier, so, po: po! };
  }

  async function payBill(year: number, supplierId: string, billId: string, cash: string, wh: string) {
    const prev = process.env.PAYABLES_2307_ENABLED;
    process.env.PAYABLES_2307_ENABLED = "true";
    try {
      return await recordSupplierPayment(
        {
          supplierId,
          date: new Date(Date.UTC(year, 2, 8)),
          method: "BANK_TRANSFER",
          reference: `REF-${tag()}`,
          checkBank: null,
          checkDate: null,
          amountPaid: cash,
          notes: null,
          cashAccountId: null,
          allocations: [
            { supplierBillId: billId, cashApplied: cash, withholdingApplied: wh, withholdingRate: "0.1000", atcCode: "WI010" },
          ],
        },
        admin,
      );
    } finally {
      if (prev === undefined) delete process.env.PAYABLES_2307_ENABLED;
      else process.env.PAYABLES_2307_ENABLED = prev;
    }
  }

  function expenseInput(year: number, extra: Record<string, unknown>) {
    return {
      date: new Date(Date.UTC(year, 2, 10)),
      supplierId: null,
      payeeText: `Payee ${tag()}`,
      categoryId,
      amount: "100.00",
      withholdingApplied: "0",
      cashAccountId: accountId,
      receiptNo: null,
      notes: null,
      salesOrderId: null,
      purchaseOrderId: null,
      businessId: null,
      ...extra,
    } as Parameters<typeof recordExpense>[0];
  }

  it("Books rows, monthly profit, supplier EWT and held-for-others all respect the wall", async () => {
    const year = await freshYear();
    const biz = await saveBusiness({ name: `Wall Biz ${tag()}`, shortLabel: "WB" }, admin);
    const tagged = await makeChain(year, biz.id);
    const own = await makeChain(year, null);
    await markPurchaseOrderSent(tagged.po.id, admin);
    await markPurchaseOrderSent(own.po.id, admin);
    const t = tag();

    const taggedBill = await recordSupplierBill(
      tagged.po.id,
      { billNumber: `SB-TAGGED-${t}`, billDate: new Date(Date.UTC(year, 2, 5)), amount: "5000.00", notes: null, lines: [] },
      admin,
    );
    const ownBill = await recordSupplierBill(
      own.po.id,
      { billNumber: `SB-OWN-${t}`, billDate: new Date(Date.UTC(year, 2, 5)), amount: "7000.00", notes: null, lines: [] },
      admin,
    );
    const taggedPay = await payBill(year, tagged.supplier.id, taggedBill.id, "3000.00", "500.00");
    const ownPay = await payBill(year, own.supplier.id, ownBill.id, "6300.00", "700.00");

    // F35: a tagged bill dated OUTSIDE the period (April), left
    // fully unpaid, must not move March's stillOwed — the figure
    // is period-scoped like the rest of the held-for-others card.
    await recordSupplierBill(
      tagged.po.id,
      { billNumber: `SB-TAGGED-APR-${t}`, billDate: new Date(Date.UTC(year, 3, 5)), amount: "4000.00", notes: null, lines: [] },
      admin,
    );

    const taggedExpLinked = await recordExpense(expenseInput(year, { amount: "350.00", salesOrderId: tagged.so.id }), admin);
    const taggedExpPick = await recordExpense(expenseInput(year, { amount: "200.00", businessId: biz.id }), admin);
    const ownExpense = await recordExpense(expenseInput(year, { amount: "900.00" }), admin);

    await recordBilling(
      {
        salesOrderId: own.so.id,
        amount: "10000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );

    // Books source rows: own documents in, tagged documents out.
    const rows = await listBookSourceRows(admin);
    const docNos = new Set(rows.map((r) => r.documentNumber));
    expect(docNos.has(taggedBill.billNumber)).toBe(false);
    expect(docNos.has(ownBill.billNumber)).toBe(true);
    expect(docNos.has(taggedPay.number)).toBe(false);
    expect(docNos.has(ownPay.number)).toBe(true);
    expect(docNos.has(ownExpense.number)).toBe(true);
    expect(docNos.has(taggedExpLinked.number)).toBe(false);
    expect(docNos.has(taggedExpPick.number)).toBe(false);

    // Monthly profit (HACIEN's): revenue from the own billing only; tagged
    // supplier bill + tagged expenses excluded; deals list is own only.
    const profit = await getMonthlyProfit(`${year}-03`);
    expect(profit.revenue).toBe("10000.00");
    expect(profit.supplierBills).toBe("7000.00");
    expect(profit.expenses).toBe("900.00");
    expect(profit.net).toBe("2100.00");
    expect(profit.deals.map((d) => d.number)).toContain(own.so.number);
    expect(profit.deals.map((d) => d.number)).not.toContain(tagged.so.number);

    // Supplier EWT worksheet: HACIEN's remittance only.
    const ewt = await getSupplierEwtWorksheet(admin, year);
    const ewtPayments = new Set(ewt.rows.map((r) => r.paymentNumber));
    expect(ewtPayments.has(ownPay.number)).toBe(true);
    expect(ewtPayments.has(taggedPay.number)).toBe(false);

    // Held for others: the tagged side, summarised.
    const held = await getHeldForOthers(admin, `${year}-03-01`, `${year}-03-31`);
    expect(held.billsRecorded).toBe("5000.00");
    expect(held.billsCount).toBe(1);
    expect(held.paymentsMade).toBe("3000.00");
    expect(held.paymentsCount).toBe(1);
    expect(held.expensesRecorded).toBe("550.00");
    expect(held.expensesCount).toBe(2);
    expect(held.stillOwed).toBe("1500.00");
  });
});
