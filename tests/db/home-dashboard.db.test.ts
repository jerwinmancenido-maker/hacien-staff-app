// Home dashboard money, flags, empty state and list-parity against MySQL.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { arAgingSummary, listBillings, listCollections } from "@/lib/billing/views";
import { currentMonthPeriod } from "@/lib/books/period";
import { money } from "@/lib/documents/common";
import { addDays, isoDate, manilaToday } from "@/lib/format";
import { loadHomeDashboard, homeSumAmounts } from "@/lib/home/dashboard";
import { listSupplierBillsDueSoon } from "@/lib/payables/views";
import { listPurchaseOrdersView, listReceivingView } from "@/lib/purchasing/views";
import { listQuotesView, listSalesOrdersView } from "@/lib/quotes/views";
import { getSettingsSnapshot } from "@/lib/settings";
import { recordBilling } from "@/lib/services/billings";
import { recordCollection } from "@/lib/services/collections";
import { listCustomers } from "@/lib/services/companies";
import {
  approvePurchaseOrder,
  createPurchaseOrdersFromSalesOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { convertQuoteToSalesOrder, createQuote, markQuoteSent, type DocActor } from "@/lib/services/quotes";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("home dashboard (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let invoiceSeq = 910_000 + Math.floor(Math.random() * 40_000);
  const nextInvoice = () => ++invoiceSeq;

  const prevEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
    await ensureWideBooklet();
    for (const k of ["PAYABLES_ENABLED", "CASH_ENABLED", "BOOKS_ENABLED"] as const) {
      prevEnv[k] = process.env[k];
    }
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet home" };
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
        /* race */
      }
    }
  }

  async function openSo(year: number, unitPrice = "100000", supplierCost = "80000") {
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
      quoteInput(customer.id, year, {
        contactId: customer.contacts[0]!.id,
        items: [
          {
            id: null,
            description: `Goods ${tag()}`,
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: supplierCost,
            unitPrice,
          },
        ],
      }),
      admin,
    );
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-${tag()}`, deliveryAddress: "Manila" }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    return { customer, supplier, so, quote: q, year };
  }

  const fromSo = (year: number) => ({
    date: new Date(Date.UTC(year, 2, 3)),
    expectedDate: null as Date | null,
    deliveryAddressText: null as string | null,
    supplierPicks: {} as Record<string, string | null>,
  });

  it("getting-started disappears once a customer exists", async () => {
    process.env.BOOKS_ENABLED = "false";
    process.env.PAYABLES_ENABLED = "false";
    process.env.CASH_ENABLED = "false";
    await makeCustomer();
    const dash = await loadHomeDashboard(admin);
    expect(dash.empty).toBe(false);
    expect(dash.gettingStarted).toBeNull();
  });

  it("money: owed split, collected/billed this month (PHT bounds), cost-permission hiding", async () => {
    process.env.PAYABLES_ENABLED = "true";
    process.env.CASH_ENABLED = "false";
    process.env.BOOKS_ENABLED = "false";

    const year = await freshYear();
    const { customer, so } = await openSo(year, "50000");
    const period = currentMonthPeriod();
    const invoiceDate = new Date(`${period.fromYmd}T00:00:00.000Z`);
    const duePast = addDays(manilaToday(), -10);

    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "20000.00",
        invoiceDate,
        dueDate: duePast,
        invoiceNo: nextInvoice(),
        notes: null,
      },
      admin,
    );
    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "10000.00",
        invoiceDate,
        dueDate: addDays(manilaToday(), 20),
        invoiceNo: nextInvoice(),
        notes: null,
      },
      admin,
    );

    await recordCollection(
      {
        customerId: customer.id,
        date: invoiceDate,
        method: "BANK_TRANSFER",
        amountReceived: "5000.00",
        receiptNo: `OR-${tag()}`,
        reference: null,
        checkBank: null,
        checkDate: null,
        notes: null,
        allocations: [],
      },
      admin,
    );

    const dashAdmin = await loadHomeDashboard(admin);
    const owed = dashAdmin.money.find((m) => m.kind === "owedByCustomers");
    const collected = dashAdmin.money.find((m) => m.kind === "collectedThisMonth");
    const billed = dashAdmin.money.find((m) => m.kind === "billedThisMonth");
    expect(owed).toBeTruthy();
    expect(collected).toBeTruthy();
    expect(billed).toBeTruthy();

    const ar = await arAgingSummary();
    expect(owed!.amount).toBe(ar.totalReceivable);
    expect(owed!.overdueAmount).toBe(ar.overdue);
    expect(owed!.showOverdueRed).toBe(Number(ar.overdue) > 0);

    const billedRows = await listBillings({ fromYmd: period.fromYmd, toYmd: period.toYmd });
    const collectedRows = await listCollections({
      status: "POSTED",
      fromYmd: period.fromYmd,
      toYmd: period.toYmd,
    });
    expect(billed!.amount).toBe(homeSumAmounts(billedRows.map((r) => r.amount)));
    expect(collected!.amount).toBe(homeSumAmounts(collectedRows.map((r) => r.amountReceived)));

    const dashStaff = await loadHomeDashboard(staff);
    expect(dashStaff.money.some((m) => m.kind === "owedByCustomers")).toBe(true);
    expect(dashStaff.money.some((m) => m.kind === "supplierBillsDueSoon")).toBe(false);
    expect(dashStaff.actions.some((a) => a.kind === "billsOverPo")).toBe(false);
  });

  it("feature flags: supplier due soon needs PAYABLES or CASH; tax needs Books + view_books", async () => {
    process.env.PAYABLES_ENABLED = "false";
    process.env.CASH_ENABLED = "false";
    process.env.BOOKS_ENABLED = "false";
    let dash = await loadHomeDashboard(admin);
    expect(dash.money.some((m) => m.kind === "supplierBillsDueSoon")).toBe(false);
    expect(dash.tax).toBeNull();

    process.env.CASH_ENABLED = "true";
    dash = await loadHomeDashboard(admin);
    expect(dash.money.some((m) => m.kind === "supplierBillsDueSoon")).toBe(true);

    process.env.CASH_ENABLED = "false";
    process.env.PAYABLES_ENABLED = "true";
    dash = await loadHomeDashboard(admin);
    expect(dash.money.some((m) => m.kind === "supplierBillsDueSoon")).toBe(true);

    process.env.BOOKS_ENABLED = "true";
    dash = await loadHomeDashboard(admin);
    expect(dash.features.booksEnabled).toBe(true);
    const staffDash = await loadHomeDashboard(staff);
    expect(staffDash.tax).toBeNull();
  });

  it("hides Needs action rows when their count is 0", async () => {
    process.env.PAYABLES_ENABLED = "false";
    process.env.CASH_ENABLED = "false";
    process.env.BOOKS_ENABLED = "false";
    const dash = await loadHomeDashboard(admin);
    for (const row of dash.actions) {
      expect(row.count).toBeGreaterThan(0);
    }
  });

  it("parity: each dashboard number matches its filtered list", async () => {
    process.env.PAYABLES_ENABLED = "true";
    process.env.CASH_ENABLED = "false";
    process.env.BOOKS_ENABLED = "false";

    const year = await freshYear();
    const { customer, supplier, so } = await openSo(year, "600000", "100");

    await createQuote(
      quoteInput(customer.id, year, {
        contactId: customer.contacts[0]!.id,
        items: [
          {
            id: null,
            description: `Big ${tag()}`,
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "100",
            unitPrice: "600000",
          },
        ],
      }),
      admin,
    );

    const stale = await createQuote(
      quoteInput(customer.id, year, {
        contactId: customer.contacts[0]!.id,
        date: addDays(manilaToday(), -10),
        items: [
          {
            id: null,
            description: `Stale ${tag()}`,
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "1000",
            unitPrice: "2000",
          },
        ],
      }),
      admin,
    );
    await markQuoteSent(stale.id, admin);
    await db.quote.update({ where: { id: stale.id }, data: { date: addDays(manilaToday(), -10) } });

    // Separate SO that still needs a PO (the one below gets a PO).
    const needsPoSo = await openSo(year, "12000", "9000");

    const [po] = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), admin);
    await approvePurchaseOrder(po!.id, admin);
    await markPurchaseOrderSent(po!.id, admin);
    const poRow = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po!.id } });
    const overAmount = String(Number(money(poRow.subtotal)) + 1500);
    await recordSupplierBill(
      po!.id,
      {
        billNumber: `SB-${tag()}`,
        billDate: manilaToday(),
        amount: overAmount,
        notes: null,
        lines: [],
      },
      admin,
    );

    await db.customer.create({
      data: { name: `None WH ${tag()}`, withholdingType: "NONE", address: "x" },
    });

    const dash = await loadHomeDashboard(admin);
    const byKind = Object.fromEntries(dash.actions.map((a) => [a.kind, a.count]));

    const needsApproval = await listQuotesView({ needsApproval: true }, admin);
    const noReply = await listQuotesView({ noReplyAfterDays: 7 }, admin);
    const needsPo = await listSalesOrdersView({ needsPo: true });
    const receiving = await listReceivingView({ history: false }, admin);
    const billedOver = await listPurchaseOrdersView({ billedOver: true }, admin);
    const overdue = await listBillings({ status: "OVERDUE" });
    const noWh = await listCustomers({ withholding: "NONE" });

    if (byKind.quotesNeedsApproval !== undefined) expect(byKind.quotesNeedsApproval).toBe(needsApproval.length);
    if (byKind.quotesNoReply !== undefined) expect(byKind.quotesNoReply).toBe(noReply.length);
    if (byKind.salesOrdersNeedsPo !== undefined) {
      expect(byKind.salesOrdersNeedsPo).toBe(needsPo.length);
      expect(needsPo.some((r) => r.id === needsPoSo.so.id)).toBe(true);
    }
    if (byKind.posAwaitingReceipt !== undefined) expect(byKind.posAwaitingReceipt).toBe(receiving.length);
    if (byKind.billsOverPo !== undefined) expect(byKind.billsOverPo).toBe(billedOver.length);
    if (byKind.billingsOverdue !== undefined) expect(byKind.billingsOverdue).toBe(overdue.length);
    if (byKind.customersNoWithholding !== undefined) expect(byKind.customersNoWithholding).toBe(noWh.length);

    const period = currentMonthPeriod();
    const billedMoney = dash.money.find((m) => m.kind === "billedThisMonth")!;
    const collectedMoney = dash.money.find((m) => m.kind === "collectedThisMonth")!;
    const owedMoney = dash.money.find((m) => m.kind === "owedByCustomers")!;
    const dueSoonMoney = dash.money.find((m) => m.kind === "supplierBillsDueSoon")!;

    const billedList = await listBillings({ fromYmd: period.fromYmd, toYmd: period.toYmd });
    const collectedList = await listCollections({ status: "POSTED", fromYmd: period.fromYmd, toYmd: period.toYmd });
    const ar = await arAgingSummary();
    const dueSoon = await listSupplierBillsDueSoon(7);

    expect(billedMoney.amount).toBe(homeSumAmounts(billedList.map((r) => r.amount)));
    expect(collectedMoney.amount).toBe(homeSumAmounts(collectedList.map((r) => r.amountReceived)));
    expect(owedMoney.amount).toBe(ar.totalReceivable);
    expect(owedMoney.overdueAmount).toBe(ar.overdue);
    expect(dueSoonMoney.amount).toBe(homeSumAmounts(dueSoon.map((b) => b.balance)));
  });

  it("loads for a no-costs user without throwing", async () => {
    const dash = await loadHomeDashboard(staff);
    expect(dash.nonVat.limit).toBeGreaterThan(0);
    expect(dash.withCosts).toBe(false);
    expect(isoDate(manilaToday()).length).toBe(10);
  });
});
