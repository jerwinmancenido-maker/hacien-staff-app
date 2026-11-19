// F15 (Jerwin approved Option A, 2026-11-19): returns are negative sales /
// negative purchases in the official figures — Books registers, Monthly
// profit, and the tax worksheets — dated in the return's period, with the
// entity wall holding (a return follows its order's business tag).
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally without it.

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
import { getSettingsSnapshot } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import { recordDelivery } from "@/lib/services/deliveries";
import { postCustomerReturn, voidCustomerReturn } from "@/lib/services/customer-returns";
import { getBookRegister } from "@/lib/services/books";
import { getMonthlyProfit } from "@/lib/services/profit";
import { getIncomeTaxWorksheet, getSalesSummaryWorksheet } from "@/lib/services/tax-worksheets";
import { createStandalonePurchaseOrder, markPurchaseOrderSent, approvePurchaseOrder } from "@/lib/services/purchase-orders";
import { postReceivingReport } from "@/lib/services/receiving";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { postSupplierReturn } from "@/lib/services/returns";
import { saveBusiness } from "@/lib/services/businesses";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet F15" };
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

async function ensureWideDrBooklet(adminId: string) {
  const typeWide = {
    atpNo: "",
    atpDate: "",
    printer: "",
    seriesFrom: 1,
    seriesTo: 9_999_999,
    bookletCount: 10,
    setsPerBooklet: 50,
    isNonVat: true,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = await getSettingsSnapshot();
    const ib = snap.settings.invoiceBooklet;
    if ((ib.deliveryReceipt?.seriesTo ?? 0) >= 9_999_999) return;
    const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
    try {
      await db.settingsVersion.create({
        data: {
          version: latest.version + 1,
          data: {
            ...(latest.data as object),
            invoiceBooklet: { ...ib, deliveryReceipt: { ...typeWide } },
          } as never,
          changedKey: "invoiceBooklet",
          before: ib,
          after: { deliveryReceipt: typeWide },
          createdById: adminId,
        },
      });
      return;
    } catch {
      /* version race */
    }
  }
}

const minus = (a: string, b: string) => (Number(a) - Number(b)).toFixed(2);

describe.skipIf(!env.hasDb)("F15 returns in Books / profit / tax worksheets (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 2_100_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 2_200_000 + Math.floor(Math.random() * 30_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-f15-uploads-"));
    admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
    await ensureWideDrBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeDeliveredSo(year: number, businessId: string | null = null) {
    const customer = await makeCustomer();
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
          { id: null, description: "Widget A", kind: "GOODS", qty: "2", unit: "pc", supplierId: null, supplierUnitCost: "0", unitPrice: "500" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-F15-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const withItems = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    const itemId = withItems.items[0]!.id;
    await recordDelivery(
      so.id,
      {
        drNumber: nextDr(),
        deliveryDate: new Date(Date.UTC(year, 2, 3)),
        idSightChecked: false,
        items: [{ salesOrderItemId: itemId, qty: "2.00" }],
      },
      admin,
    );
    return { customer, so, itemId };
  }

  it("a customer return nets the sales register, profit and both tax worksheets; voiding restores them", async () => {
    const year = await freshYear();
    const month = `${year}-03`;
    const from = `${year}-03-01`;
    const to = `${year}-03-31`;
    const { so, itemId } = await makeDeliveredSo(year);
    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "1000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );

    const salesBefore = (await getBookRegister(admin, "sales", from, to)).register;
    const profitBefore = await getMonthlyProfit(month);
    const sheetBefore = await getIncomeTaxWorksheet(admin, year, 1);
    expect(profitBefore.customerReturns).toBe("0.00");
    expect(sheetBefore.invoicedReturnsTotal).toBe("0.00");

    const ret = await postCustomerReturn(
      so.id,
      { returnDate: new Date(Date.UTC(year, 2, 10)), reason: "Defective", lines: [{ lineId: itemId, qty: "1" }] },
      admin,
    );

    // Books sales register: the return is a negative line inside Invoiced.
    const salesAfter = (await getBookRegister(admin, "sales", from, to)).register;
    const retRow = salesAfter.rows.find((r) => r.id === ret.id);
    expect(retRow?.kind).toBe("CUSTOMER_RETURN");
    expect(retRow?.amount).toBe("-500.00");
    expect(salesAfter.salesPeriodTotals!.invoicedAmount).toBe(minus(salesBefore.salesPeriodTotals!.invoicedAmount, "500.00"));
    expect(salesAfter.salesPeriodTotals!.collectedAmount).toBe(salesBefore.salesPeriodTotals!.collectedAmount);

    // Monthly profit: revenue drops by the return; the deal line nets too.
    const profitAfter = await getMonthlyProfit(month);
    expect(profitAfter.customerReturns).toBe("500.00");
    expect(profitAfter.revenue).toBe(minus(profitBefore.revenue, "500.00"));
    const deal = profitAfter.deals.find((d) => d.number === so.number);
    expect(deal?.returns).toBe("500.00");
    expect(deal?.contractPrice).toBe("500.00");

    // Income worksheet: gross unchanged, returns shown, net is gross - 500.
    const sheetAfter = await getIncomeTaxWorksheet(admin, year, 1);
    expect(sheetAfter.invoicedGrossTotal).toBe(sheetBefore.invoicedGrossTotal);
    expect(sheetAfter.invoicedReturnsTotal).toBe("500.00");
    expect(sheetAfter.invoicedTotal).toBe(minus(sheetAfter.invoicedGrossTotal, "500.00"));
    expect(sheetAfter.collectedTotal).toBe(sheetBefore.collectedTotal);

    // Sales summary: March carries the return; net = gross - returns.
    const summary = await getSalesSummaryWorksheet(admin, year);
    const march = summary.months.find((m) => m.month === month)!;
    expect(march.returns).toBe("500.00");
    expect(march.netSales).toBe(minus(march.grossSales, "500.00"));
    expect(summary.yearReturns).toBe("500.00");

    // Voiding the return restores every figure.
    await voidCustomerReturn(ret.id, "Entered by mistake", admin);
    const salesRestored = (await getBookRegister(admin, "sales", from, to)).register;
    expect(salesRestored.rows.find((r) => r.id === ret.id)).toBeUndefined();
    expect(salesRestored.salesPeriodTotals!.invoicedAmount).toBe(salesBefore.salesPeriodTotals!.invoicedAmount);
    const profitRestored = await getMonthlyProfit(month);
    expect(profitRestored.customerReturns).toBe("0.00");
    expect(profitRestored.revenue).toBe(profitBefore.revenue);
    const sheetRestored = await getIncomeTaxWorksheet(admin, year, 1);
    expect(sheetRestored.invoicedReturnsTotal).toBe("0.00");
    expect(sheetRestored.invoicedTotal).toBe(sheetBefore.invoicedTotal);
  });

  it("a supplier return nets the purchases register and profit's supplier bills", async () => {
    const year = await freshYear();
    const month = `${year}-03`;
    const from = `${year}-03-01`;
    const to = `${year}-03-31`;
    const supplier = await makeSupplier();
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
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "10", unit: "lot", unitCost: "100.00" }],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, admin);
    await markPurchaseOrderSent(po.id, admin);
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, orderBy: { sortOrder: "asc" } });
    const lineId = lines[0]!.id;
    await postReceivingReport(
      po.id,
      { receivedDate: new Date(Date.UTC(year, 2, 4)), receivedById: admin.id, deliveryRef: "DR-F15", notes: null, lines: [{ lineId, qty: "10" }] },
      admin,
    );
    await recordSupplierBill(
      po.id,
      { billNumber: `SB-F15-${tag()}`, billDate: new Date(Date.UTC(year, 2, 5)), amount: "1000.00", notes: null, lines: [] },
      admin,
    );

    const purchasesBefore = (await getBookRegister(admin, "purchases", from, to)).register;
    const profitBefore = await getMonthlyProfit(month);
    expect(profitBefore.supplierReturns).toBe("0.00");

    const ret = await postSupplierReturn(
      po.id,
      { returnDate: new Date(Date.UTC(year, 2, 12)), reason: "Defective", creditNoteNumber: "CN-1", creditNoteAmount: null, lines: [{ lineId, qty: "2" }] },
      admin,
    );

    const purchasesAfter = (await getBookRegister(admin, "purchases", from, to)).register;
    const retRow = purchasesAfter.rows.find((r) => r.id === ret.id);
    expect(retRow?.kind).toBe("SUPPLIER_RETURN");
    expect(retRow?.amount).toBe("-200.00");
    expect(purchasesAfter.periodAmountTotal).toBe(minus(purchasesBefore.periodAmountTotal!, "200.00"));

    const profitAfter = await getMonthlyProfit(month);
    expect(profitAfter.supplierReturns).toBe("200.00");
    expect(profitAfter.supplierBills).toBe(minus(profitBefore.supplierBills, "200.00"));
  });

  it("a return on another business's sales order never enters HACIEN's figures", async () => {
    const year = await freshYear();
    const month = `${year}-03`;
    const from = `${year}-03-01`;
    const to = `${year}-03-31`;
    const biz = await saveBusiness({ name: `F15 Biz ${tag()}`, shortLabel: "FB" }, admin);
    const { so, itemId } = await makeDeliveredSo(year, biz.id);

    const profitBefore = await getMonthlyProfit(month);
    const sheetBefore = await getIncomeTaxWorksheet(admin, year, 1);

    const ret = await postCustomerReturn(
      so.id,
      { returnDate: new Date(Date.UTC(year, 2, 10)), reason: "Defective", lines: [{ lineId: itemId, qty: "1" }] },
      admin,
    );

    const sales = (await getBookRegister(admin, "sales", from, to)).register;
    expect(sales.rows.find((r) => r.id === ret.id)).toBeUndefined();
    const profitAfter = await getMonthlyProfit(month);
    expect(profitAfter.customerReturns).toBe(profitBefore.customerReturns);
    expect(profitAfter.revenue).toBe(profitBefore.revenue);
    const sheetAfter = await getIncomeTaxWorksheet(admin, year, 1);
    expect(sheetAfter.invoicedReturnsTotal).toBe(sheetBefore.invoicedReturnsTotal);
  });
});
