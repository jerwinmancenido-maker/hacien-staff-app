// Tax worksheets against MySQL 8 (TEST_DATABASE_URL). Uses clearly fake data only.

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
import {
  creditableWithholdingYtd,
  cumulativeCollectedTotal,
  cumulativeGrossSales,
  cumulativeInvoicedTotal,
  getCustomer2307Worksheet,
  getIncomeTaxWorksheet,
  getSalesSummaryWorksheet,
  getSupplierEwtWorksheet,
  saveTaxPaidQuarter,
} from "@/lib/services/tax-worksheets";
import { TAX_BASIS_UNVERIFIED_NOTE } from "@/lib/tax/constants";
import { NON_VAT_THRESHOLD_PESOS } from "@/lib/tax/constants";
import { build1701qWorksheet } from "@/lib/tax/math";
import { manilaYmdFromInstant } from "@/lib/books/period";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("tax worksheets (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let invoiceSeq = 900_000 + Math.floor(Math.random() * 40_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-tax-uploads-"));
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
    await ensureWideBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

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
              invoiceBooklet: { seriesFrom: 1, seriesTo: 9_999_999, label: "Tax test booklet" },
              features: { ...snap.settings.features, booksEnabled: true },
            } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: { seriesFrom: 1, seriesTo: 9_999_999, label: "Tax test booklet" },
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // Unique version race — retry.
      }
    }
  }

  async function openSo(year: number, unitPrice = "100000") {
    const customer = await makeCustomer(["GOODS_1"]);
    // Fake TIN only — never real customer data in tests.
    const ct = tag();
    await db.customer.update({
      where: { id: customer.id },
      data: { tin: `000-${ct.slice(0, 3)}-${ct.slice(3, 6)}-${ct.slice(0, 3)}` },
    });
    const supplier = await makeSupplier();
    const st = tag();
    await db.supplier.update({
      where: { id: supplier.id },
      data: { tin: `111-${st.slice(0, 3)}-${st.slice(3, 6)}-${st.slice(0, 3)}` },
    });
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
        date: new Date(Date.UTC(year, 0, 15)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          {
            id: null,
            description: "Fake goods for tax worksheet test",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "80000",
            unitPrice,
          },
        ],
      },
      admin,
    );
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-TAX-${tag()}`, deliveryAddress: "Test City" }, admin, {
      date: new Date(Date.UTC(year, 0, 16)),
    });
    return { customer, supplier, so, year };
  }

  it("view_books is enforced (Staff forbidden)", async () => {
    await expect(getIncomeTaxWorksheet(staff, 2026, 1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCustomer2307Worksheet(staff, 2026, 1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSupplierEwtWorksheet(staff, 2026, 1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSalesSummaryWorksheet(staff, 2026)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cumulative gross sales by invoiceDate; voids excluded; PHT quarter end inclusive", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    // Large enough SO so voided + kept billings fit before voids restore remaining.
    const { so } = await openSo(year, "500000");

    const jan = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "100000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 0, 10)),
        dueDate: new Date(Date.UTC(year, 1, 9)),
        notes: null,
      },
      admin,
    );
    const voided = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "99999.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 1, 15)),
        dueDate: new Date(Date.UTC(year, 2, 15)),
        notes: null,
      },
      admin,
    );
    await voidBilling(voided.id, "void for tax test", admin);
    const mar31 = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "50000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 31)),
        dueDate: new Date(Date.UTC(year, 3, 30)),
        notes: null,
      },
      admin,
    );
    const apr1 = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "25000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 3, 1)),
        dueDate: new Date(Date.UTC(year, 4, 1)),
        notes: null,
      },
      admin,
    );

    expect(manilaYmdFromInstant(new Date(`${year}-03-31T15:59:00.000Z`))).toBe(`${year}-03-31`);
    expect(manilaYmdFromInstant(new Date(`${year}-03-31T16:00:00.000Z`))).toBe(`${year}-04-01`);

    const q1 = await cumulativeInvoicedTotal(year, 1);
    expect(toScaled(q1, 2)).toBe(toScaled("150000.00", 2)); // jan + mar31; not apr1; not voided
    expect(await cumulativeGrossSales(year, 1)).toBe(q1); // alias

    const q2 = await cumulativeInvoicedTotal(year, 2);
    expect(toScaled(q2, 2)).toBe(toScaled("175000.00", 2)); // + apr1

    const sheet = await getIncomeTaxWorksheet(admin, year, 1);
    expect(sheet.invoicedTotal).toBe(q1);
    expect(sheet.collectedTotal).toBe(await cumulativeCollectedTotal(year, 1));
    // Must not pick a single basis or use sales+collections combined total.
    expect(sheet.basisNote).toBe(TAX_BASIS_UNVERIFIED_NOTE);
    expect(sheet.invoiced.a).toBe(sheet.invoicedTotal);
    expect(sheet.collected.a).toBe(sheet.collectedTotal);
    expect(sheet.overThreshold).toBe(false);
    // Sanity: source ids exist
    expect(jan.id && mar31.id && apr1.id).toBeTruthy();
  });

  it("₱250k allowance edge and >₱3M warning from live billings", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    // Large unit price so one billing can cross thresholds with fake data.
    const { so } = await openSo(year, "3500000");

    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "250000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 0, 20)),
        dueDate: new Date(Date.UTC(year, 1, 20)),
        notes: null,
      },
      admin,
    );
    let sheet = await getIncomeTaxWorksheet(admin, year, 1);
    expect(sheet.invoicedTotal).toBe("250000.00");
    expect(sheet.invoiced.c).toBe("0.00");
    expect(sheet.invoiced.d).toBe("0.00");
    expect(sheet.overThreshold).toBe(false);
    expect(sheet.basisNote).toBe(TAX_BASIS_UNVERIFIED_NOTE);

    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "0.01",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 1, 1)),
        dueDate: new Date(Date.UTC(year, 2, 1)),
        notes: null,
      },
      admin,
    );
    sheet = await getIncomeTaxWorksheet(admin, year, 1);
    expect(sheet.invoicedTotal).toBe("250000.01");
    expect(sheet.invoiced.c).toBe("0.01");

    // Cross ₱3M with another fake billing
    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "2750000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 1)),
        dueDate: new Date(Date.UTC(year, 3, 1)),
        notes: null,
      },
      admin,
    );
    sheet = await getIncomeTaxWorksheet(admin, year, 1);
    expect(toScaled(sheet.invoicedTotal, 2)).toBeGreaterThan(toScaled(NON_VAT_THRESHOLD_PESOS, 2));
    expect(sheet.overThreshold).toBe(true);
    expect(sheet.invoiced.overThreshold).toBe(true);
  });

  it("2307 totals match collections EWT; voids excluded; tax-paid saves with audit", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    const { customer, so } = await openSo(year, "100000");

    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "10000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 0, 10)),
        dueDate: new Date(Date.UTC(year, 1, 9)),
        notes: null,
      },
      admin,
    );

    const col = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 1, 15)),
        method: "BANK_TRANSFER",
        reference: `TAX-COL-${tag()}`,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-TAX-${tag()}`,
        amountReceived: "9900.00",
        notes: null,
        cashAccountId: null,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "9900.00",
            withholdingApplied: "100.00",
          },
        ],
      },
      admin,
    );

    const voidCol = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 1, 16)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "50.00",
        notes: null,
        cashAccountId: null,
        allocations: [],
      },
      admin,
    );
    // Create a second billing + collection with EWT then void it
    const billing2 = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "5000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 1, 5)),
        dueDate: new Date(Date.UTC(year, 2, 5)),
        notes: null,
      },
      admin,
    );
    const colVoidEwt = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 1, 20)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "4950.00",
        notes: null,
        cashAccountId: null,
        allocations: [
          {
            billingId: billing2.id,
            cashApplied: "4950.00",
            withholdingApplied: "50.00",
          },
        ],
      },
      admin,
    );
    await voidCollection(colVoidEwt.id, "void ewt", admin);
    await voidCollection(voidCol.id, "void plain", admin);

    const f = await creditableWithholdingYtd(year, 1);
    expect(f).toBe("100.00");

    const list = await getCustomer2307Worksheet(admin, year, 1);
    expect(list.totalTax).toBe("100.00");
    expect(list.rows.every((r) => r.name.startsWith("Test Customer"))).toBe(true);
    expect(list.rows.some((r) => r.collectionId === col.id)).toBe(true);
    expect(list.rows.some((r) => r.collectionId === colVoidEwt.id)).toBe(false);

    // Manual tax paid for Q1 → appears on Q2 line (e)
    await saveTaxPaidQuarter({ year, quarter: 1, amountPaid: "1234.56", notes: "fake OR" }, admin);
    const audits = await db.auditLog.findMany({
      where: { entityType: "TaxPaidQuarter" },
      orderBy: { at: "desc" },
      take: 5,
    });
    expect(audits.some((a) => a.action === "create" || a.action === "update")).toBe(true);

    const q2 = await getIncomeTaxWorksheet(admin, year, 2);
    expect(q2.invoiced.e).toBe("1234.56");
    expect(q2.collected.e).toBe("1234.56");
    expect(q2.invoiced.f).toBe("100.00");
    expect(q2.collected.f).toBe("100.00");
    // Collected total is collections only (not billings+collections combined).
    expect(toScaled(q2.collectedTotal, 2)).toBe(toScaled("9900.00", 2));
    expect(q2.basisNote).toBe(TAX_BASIS_UNVERIFIED_NOTE);

    // Pure math cross-check for each column
    const pureInv = build1701qWorksheet({
      cumulativeGrossSales: q2.invoicedTotal,
      taxPaidEarlierQuarters: q2.invoiced.e,
      creditableWithholding: q2.invoiced.f,
    });
    expect(pureInv.g).toBe(q2.invoiced.g);
    const pureCol = build1701qWorksheet({
      cumulativeGrossSales: q2.collectedTotal,
      taxPaidEarlierQuarters: q2.collected.e,
      creditableWithholding: q2.collected.f,
    });
    expect(pureCol.g).toBe(q2.collected.g);
  });

  it("supplier EWT by month/quarter; voids excluded; separate from customers", async () => {
    const year = await freshYear();
    const supplier = await makeSupplier();
    await db.supplier.update({
      where: { id: supplier.id },
      data: { tin: `222-${tag().slice(0, 3)}-${tag().slice(0, 3)}-222`, name: `Fake Supplier ${tag()}` },
    });
    const t = tag();

    const po = await createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 0, 1)),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [
          {
            id: null,
            description: "Fake widget",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            unitCost: "10000.00",
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
        billNumber: `SB-TAX-${t}`,
        billDate: new Date(Date.UTC(year, 0, 5)),
        amount: "10000.00",
        notes: null,
        lines: [],
      },
      admin,
    );

    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 1, 10)),
        method: "BANK_TRANSFER",
        reference: `EWT-TAX-${t}`,
        checkBank: null,
        checkDate: null,
        amountPaid: "9900.00",
        notes: null,
        cashAccountId: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "9900.00",
            withholdingApplied: "100.00",
            withholdingRate: "0.0100",
            atcCode: "WC010",
          },
        ],
      },
      admin,
    );

    const sheet = await getSupplierEwtWorksheet(admin, year, 1);
    expect(toScaled(sheet.totalTax, 2)).toBe(toScaled("100.00", 2));
    expect(sheet.rows.every((r) => r.name.startsWith("Fake Supplier") || r.name.startsWith("Test Supplier"))).toBe(true);
    expect(sheet.monthlyTotals.find((m) => m.month === 2)?.tax).toBe("100.00");
    expect(sheet.quarterlyTotals.find((q) => q.quarter === 1)?.tax).toBe("100.00");

    // Customer worksheet must not list supplier names
    const cust = await getCustomer2307Worksheet(admin, year, 1);
    expect(cust.rows.every((r) => !r.name.includes("Supplier"))).toBe(true);

    await voidSupplierPayment(pay.id, "void ewt pay", admin);
    const after = await getSupplierEwtWorksheet(admin, year, 1);
    expect(after.rows.some((r) => r.paymentId === pay.id)).toBe(false);
  });

  it("sales summary by month excludes voids and links months", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    const { so } = await openSo(year, "50000");
    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "1000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 4, 5)),
        dueDate: new Date(Date.UTC(year, 5, 5)),
        notes: null,
      },
      admin,
    );
    const voided = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "500.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 4, 6)),
        dueDate: new Date(Date.UTC(year, 5, 6)),
        notes: null,
      },
      admin,
    );
    await voidBilling(voided.id, "void", admin);

    const summary = await getSalesSummaryWorksheet(admin, year);
    const may = summary.months.find((m) => m.month === `${year}-05`);
    expect(may?.grossSales).toBe("1000.00");
    expect(may?.billingCount).toBe(1);
    expect(may?.href).toContain(`/books/sales?from=${year}-05-01`);
    expect(toScaled(summary.yearTotal, 2)).toBeGreaterThanOrEqual(toScaled("1000.00", 2));
    expect(money).toBeTruthy();
  });
});
