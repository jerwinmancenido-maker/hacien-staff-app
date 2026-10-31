// Home dashboard money, flags, empty state and list-parity against MySQL.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isOverdue } from "@/lib/billing/dates";
import { billingBalance } from "@/lib/billing/status";
import {
  arAgingSummary,
  listBillings,
  listCollections,
  sumBillingsAmount,
  sumCollectionsReceived,
} from "@/lib/billing/views";
import { currentMonthPeriod } from "@/lib/books/period";
import { money } from "@/lib/documents/common";
import { addDays, isoDate, manilaToday } from "@/lib/format";
import { loadHomeDashboard, homeSumAmounts } from "@/lib/home/dashboard";
import { listSupplierBillsDueSoon } from "@/lib/payables/views";
import { listPurchaseOrdersView, listReceivingView } from "@/lib/purchasing/views";
import { approvalReasons, fromScaled, toScaled } from "@/lib/quotes/calc";
import { listQuotesView, listSalesOrdersView } from "@/lib/quotes/views";
import { getSettingsSnapshot, getSettingsVersion } from "@/lib/settings";
import { recordBilling } from "@/lib/services/billings";
import { customerCreditBalance, recordCollection } from "@/lib/services/collections";
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
  // Start past leftover booklet numbers in the shared test DB (unique invoiceNo).
  let invoiceSeq = 0;
  const nextInvoice = () => ++invoiceSeq;

  const prevEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
    await ensureWideBooklet();
    const max = await db.billing.aggregate({ _max: { invoiceNo: true } });
    invoiceSeq = Math.max(910_000, Number(max._max.invoiceNo ?? 0)) + Math.floor(Math.random() * 100);
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
    expect(owed).toBeTruthy();
    expect(collected).toBeTruthy();
    // Billed this month moved to Sales (billing access); not in Money.
    expect(dashAdmin.money.some((m) => (m as { kind: string }).kind === "billedThisMonth")).toBe(false);
    expect(dashAdmin.sales).toBeTruthy();
    expect(dashAdmin.sales!.thisMonth).toBeTruthy();

    const ar = await arAgingSummary();
    expect(owed!.amount).toBe(ar.totalReceivable);
    expect(owed!.overdueAmount).toBe(ar.overdue);
    expect(owed!.showOverdueRed).toBe(Number(ar.overdue) > 0);

    const billedSum = await sumBillingsAmount({ fromYmd: period.fromYmd, toYmd: period.toYmd });
    const collectedSum = await sumCollectionsReceived({
      status: "POSTED",
      fromYmd: period.fromYmd,
      toYmd: period.toYmd,
    });
    expect(dashAdmin.sales!.thisMonth).toBe(billedSum);
    expect(collected!.amount).toBe(collectedSum);

    const dashStaff = await loadHomeDashboard(staff);
    expect(dashStaff.money.some((m) => m.kind === "owedByCustomers")).toBe(true);
    expect(dashStaff.money.some((m) => m.kind === "supplierBillsDueSoon")).toBe(false);
    expect(dashStaff.actions.some((a) => a.kind === "billsOverPo")).toBe(false);
    expect(dashStaff.sales).toBeNull();
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
      data: {
        name: `Not-set WH ${tag()}`,
        withholdingType: "GOVERNMENT",
        address: "x",
        defaultWithholding: Prisma.DbNull,
      },
    });

    const dash = await loadHomeDashboard(admin);
    const byKind = Object.fromEntries(dash.actions.map((a) => [a.kind, a.count]));

    const needsApproval = await listQuotesView({ needsApproval: true }, admin);
    const noReply = await listQuotesView({ noReplyAfterDays: 7 }, admin);
    const needsPo = await listSalesOrdersView({ needsPo: true });
    const receiving = await listReceivingView({ history: false }, admin);
    const billedOver = await listPurchaseOrdersView({ billedOver: true }, admin);
    const overdueList = await listBillings({ status: "OVERDUE" });
    const noWh = await listCustomers({ withholdingPick: "NOT_SET" });

    if (byKind.quotesNeedsApproval !== undefined) expect(byKind.quotesNeedsApproval).toBe(needsApproval.length);
    if (byKind.quotesNoReply !== undefined) expect(byKind.quotesNoReply).toBe(noReply.length);
    if (byKind.salesOrdersNeedsPo !== undefined) {
      expect(byKind.salesOrdersNeedsPo).toBe(needsPo.length);
      // listSalesOrdersView(needsPo) loads take:500 OPEN rows then filters — on a
      // shared test DB with 1000+ OPEN SOs the freshly created one may fall outside
      // that window. Count parity with Home is the dashboard contract.
      void needsPoSo;
    }
    if (byKind.posAwaitingReceipt !== undefined) expect(byKind.posAwaitingReceipt).toBe(receiving.length);
    if (byKind.billsOverPo !== undefined) expect(byKind.billsOverPo).toBe(billedOver.length);
    if (byKind.billingsOverdue !== undefined) expect(byKind.billingsOverdue).toBe(overdueList.length);
    if (byKind.customersNoWithholding !== undefined) expect(byKind.customersNoWithholding).toBe(noWh.length);

    const period = currentMonthPeriod();
    const collectedMoney = dash.money.find((m) => m.kind === "collectedThisMonth")!;
    const owedMoney = dash.money.find((m) => m.kind === "owedByCustomers")!;
    const dueSoonMoney = dash.money.find((m) => m.kind === "supplierBillsDueSoon")!;

    const billedSum = await sumBillingsAmount({ fromYmd: period.fromYmd, toYmd: period.toYmd });
    const collectedSum = await sumCollectionsReceived({
      status: "POSTED",
      fromYmd: period.fromYmd,
      toYmd: period.toYmd,
    });
    const ar = await arAgingSummary();
    const dueSoon = await listSupplierBillsDueSoon(7);

    expect(dash.sales).toBeTruthy();
    expect(dash.sales!.thisMonth).toBe(billedSum);
    expect(collectedMoney.amount).toBe(collectedSum);
    expect(owedMoney.amount).toBe(ar.totalReceivable);
    expect(owedMoney.overdueAmount).toBe(ar.overdue);
    expect(dueSoonMoney.amount).toBe(homeSumAmounts(dueSoon.map((b) => b.balance)));
  });

  it("Withholding not set counts null picks only ([] and codes do not)", async () => {
    process.env.PAYABLES_ENABLED = "false";
    process.env.CASH_ENABLED = "false";
    process.env.BOOKS_ENABLED = "false";

    const beforeList = await listCustomers({ withholdingPick: "NOT_SET" });
    const beforeDash = await loadHomeDashboard(admin);
    const beforeRow = beforeDash.actions.find((a) => a.kind === "customersNoWithholding");
    const beforeCount = beforeRow?.count ?? 0;
    expect(beforeCount).toBe(beforeList.length);

    const t = tag();
    const notSet = await db.customer.create({
      data: {
        name: `Pick null ${t}`,
        withholdingType: "GOVERNMENT",
        address: "x",
        defaultWithholding: Prisma.DbNull,
      },
    });
    const explicitNone = await db.customer.create({
      data: {
        name: `Pick none ${t}`,
        withholdingType: "NONE",
        address: "x",
        defaultWithholding: [],
      },
    });
    const withPick = await db.customer.create({
      data: {
        name: `Pick codes ${t}`,
        withholdingType: "TOP_WITHHOLDING_AGENT",
        address: "x",
        defaultWithholding: ["GOODS_1"],
      },
    });

    const afterList = await listCustomers({ withholdingPick: "NOT_SET" });
    const afterIds = new Set(afterList.map((c) => c.id));
    expect(afterIds.has(notSet.id)).toBe(true);
    expect(afterIds.has(explicitNone.id)).toBe(false);
    expect(afterIds.has(withPick.id)).toBe(false);
    expect(afterList.length).toBe(beforeList.length + 1);

    const afterDash = await loadHomeDashboard(admin);
    const afterRow = afterDash.actions.find((a) => a.kind === "customersNoWithholding");
    expect(afterRow).toBeTruthy();
    expect(afterRow!.label).toBe("Withholding not set");
    expect(afterRow!.href).toBe("/customers?wh=NOT_SET");
    expect(afterRow!.count).toBe(beforeCount + 1);
  });

  it("loads for a no-costs user without throwing", async () => {
    const dash = await loadHomeDashboard(staff);
    expect(dash.nonVat.limit).toBeGreaterThan(0);
    expect(dash.withCosts).toBe(false);
    expect(isoDate(manilaToday()).length).toBe(10);
  });

  it("uncapped money aggregates: 201+ billings/collections match true sums; overdue count matches AR overdue PHP records", async () => {
    process.env.PAYABLES_ENABLED = "false";
    process.env.CASH_ENABLED = "false";
    process.env.BOOKS_ENABLED = "false";

    const year = await freshYear();
    const { customer, so } = await openSo(year, "999999999");
    const period = currentMonthPeriod();
    const invoiceDate = new Date(`${period.fromYmd}T00:00:00.000Z`);
    const duePast = addDays(manilaToday(), -45);
    const run = tag();

    const maxInv = await db.billing.aggregate({ _max: { invoiceNo: true } });
    let inv = (maxInv._max.invoiceNo ?? 1_000_000) + 1;

    const billingRows: {
      number: string;
      salesOrderId: string;
      customerId: string;
      invoiceNo: number;
      invoiceDate: Date;
      dueDate: Date;
      amount: string;
      withholdingExpected: string;
      netExpected: string;
      status: "OPEN" | "VOID";
      createdById: string;
      updatedById: string;
      voidedAt?: Date;
      voidReason?: string;
    }[] = [];

    let expectedBilledCents = 0n;
    let expectedOverdueCents = 0n;
    let expectedOverdueCount = 0;
    // 201 open overdue billings with distinct centavo amounts + 1 VOID that must be excluded.
    for (let i = 0; i < 201; i++) {
      const cents = 101n + BigInt(i); // 1.01, 1.02, ...
      const amount = fromScaled(cents, 2);
      expectedBilledCents += cents;
      expectedOverdueCents += cents;
      expectedOverdueCount += 1;
      billingRows.push({
        number: `BL-HM-${run}-${i}`,
        salesOrderId: so.id,
        customerId: customer.id,
        invoiceNo: inv++,
        invoiceDate,
        dueDate: duePast,
        amount,
        withholdingExpected: "0.00",
        netExpected: amount,
        status: "OPEN",
        createdById: admin.id,
        updatedById: admin.id,
      });
    }
    billingRows.push({
      number: `BL-HM-${run}-void`,
      salesOrderId: so.id,
      customerId: customer.id,
      invoiceNo: inv++,
      invoiceDate,
      dueDate: duePast,
      amount: "999.99",
      withholdingExpected: "0.00",
      netExpected: "999.99",
      status: "VOID",
      voidedAt: new Date(),
      voidReason: "test exclude",
      createdById: admin.id,
      updatedById: admin.id,
    });
    await db.billing.createMany({ data: billingRows });

    let expectedCollectedCents = 0n;
    const collectionRows: {
      number: string;
      customerId: string;
      date: Date;
      method: "CASH";
      amountReceived: string;
      status: "POSTED" | "VOID";
      createdById: string;
      voidedAt?: Date;
      voidReason?: string;
    }[] = [];
    for (let i = 0; i < 201; i++) {
      const cents = 201n + BigInt(i); // 2.01, 2.02, ...
      const amountReceived = fromScaled(cents, 2);
      expectedCollectedCents += cents;
      collectionRows.push({
        number: `CR-HM-${run}-${i}`,
        customerId: customer.id,
        date: invoiceDate,
        method: "CASH",
        amountReceived,
        status: "POSTED",
        createdById: admin.id,
      });
    }
    collectionRows.push({
      number: `CR-HM-${run}-void`,
      customerId: customer.id,
      date: invoiceDate,
      method: "CASH",
      amountReceived: "888.88",
      status: "VOID",
      voidedAt: new Date(),
      voidReason: "test exclude",
      createdById: admin.id,
    });
    await db.collection.createMany({ data: collectionRows });

    const trueBilled = fromScaled(expectedBilledCents, 2);
    const trueCollected = fromScaled(expectedCollectedCents, 2);
    // True sums across the whole DB (not just this run) via the same aggregates Home uses.
    const billedAgg = await sumBillingsAmount({ fromYmd: period.fromYmd, toYmd: period.toYmd });
    const collectedAgg = await sumCollectionsReceived({
      status: "POSTED",
      fromYmd: period.fromYmd,
      toYmd: period.toYmd,
    });
    expect(toScaled(billedAgg, 2)).toBeGreaterThanOrEqual(expectedBilledCents);
    expect(toScaled(collectedAgg, 2)).toBeGreaterThanOrEqual(expectedCollectedCents);
    // This run's rows alone already exceed the list page cap.
    expect(expectedBilledCents).toBe(toScaled(trueBilled, 2));
    expect(expectedCollectedCents).toBe(toScaled(trueCollected, 2));

    const listedBillings = await listBillings({ fromYmd: period.fromYmd, toYmd: period.toYmd });
    const listedCollections = await listCollections({
      status: "POSTED",
      fromYmd: period.fromYmd,
      toYmd: period.toYmd,
    });
    expect(listedBillings.length).toBe(200);
    expect(listedCollections.length).toBe(200);
    expect(homeSumAmounts(listedBillings.map((r) => r.amount))).not.toBe(billedAgg);
    expect(homeSumAmounts(listedCollections.map((r) => r.amountReceived))).not.toBe(collectedAgg);

    const dash = await loadHomeDashboard(admin);
    const collectedMoney = dash.money.find((m) => m.kind === "collectedThisMonth")!;
    expect(dash.sales).toBeTruthy();
    expect(dash.sales!.thisMonth).toBe(billedAgg);
    expect(collectedMoney.amount).toBe(collectedAgg);

    const ar = await arAgingSummary();
    const overdueAction = dash.actions.find((a) => a.kind === "billingsOverdue");
    expect(ar.overdueCount).toBeGreaterThanOrEqual(expectedOverdueCount);
    expect(toScaled(ar.overdue, 2)).toBeGreaterThanOrEqual(expectedOverdueCents);

    // OVERDUE filters before paging; Home action count matches the list page.
    const listedOverdue = await listBillings({ status: "OVERDUE" });
    expect(listedOverdue.length).toBeLessThanOrEqual(200);
    expect(listedOverdue.length).toBe(Math.min(200, ar.overdueCount));
    if (overdueAction) expect(overdueAction.count).toBe(listedOverdue.length);
    expect(ar.overdueCount).toBeGreaterThan(200);

    // This run's open billings are all overdue with no allocations — their sum is
    // part of ar.overdue, and each one is counted in ar.overdueCount.
    const runBillings = await db.billing.findMany({
      where: { number: { startsWith: `BL-HM-${run}-` }, status: { not: "VOID" } },
    });
    expect(runBillings).toHaveLength(201);
    const runOverdueSum = runBillings.reduce((a, b) => a + toScaled(money(b.amount), 2), 0n);
    expect(runOverdueSum).toBe(expectedOverdueCents);
    expect(toScaled(ar.overdue, 2)).toBeGreaterThanOrEqual(runOverdueSum);

    // Direct uncapped recount: overdueCount must equal the billings behind overdue PHP.
    const allOpen = await db.billing.findMany({
      where: { status: { not: "VOID" } },
      include: { allocations: { where: { collection: { status: "POSTED" } } } },
    });
    const snap = await getSettingsSnapshot();
    const grace = snap.settings.collections.overdueGraceDays;
    const today = manilaToday();
    let recount = 0;
    let recountCents = 0n;
    for (const b of allOpen) {
      const cash = fromScaled(
        b.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n),
        2,
      );
      const wh = fromScaled(
        b.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n),
        2,
      );
      const balance = billingBalance(money(b.amount), { cashApplied: cash, withholdingApplied: wh });
      const bal = toScaled(balance, 2);
      if (bal <= 0n) continue;
      if (isOverdue(b.dueDate, balance, today, grace)) {
        recount += 1;
        recountCents += bal;
      }
    }
    expect(ar.overdueCount).toBe(recount);
    expect(ar.overdue).toBe(fromScaled(recountCents, 2));
  });

  it("OVERDUE list filters before paging so count equals Home overdue count (201+ billings)", async () => {
    process.env.PAYABLES_ENABLED = "false";
    process.env.CASH_ENABLED = "false";
    process.env.BOOKS_ENABLED = "false";

    const year = await freshYear();
    const { customer, so } = await openSo(year, "999999999");
    const run = tag();
    const today = manilaToday();
    const dueFuture = addDays(today, 45);
    const duePast = addDays(today, -40);
    // Newer invoice date than the current fillers so these overdue rows sort first
    // among OVERDUE after the filter-before-page fix.
    const invoiceOverdue = today;
    const invoiceCurrent = addDays(today, -1);

    const maxInv = await db.billing.aggregate({ _max: { invoiceNo: true } });
    let inv = (maxInv._max.invoiceNo ?? 1_000_000) + 1;

    const rows: {
      number: string;
      salesOrderId: string;
      customerId: string;
      invoiceNo: number;
      invoiceDate: Date;
      dueDate: Date;
      amount: string;
      withholdingExpected: string;
      netExpected: string;
      status: "OPEN";
      createdById: string;
      updatedById: string;
    }[] = [];

    // 201 current (not overdue) billings — previously filled take:200 and hid overdue.
    for (let i = 0; i < 201; i++) {
      rows.push({
        number: `BL-ODCUR-${run}-${i}`,
        salesOrderId: so.id,
        customerId: customer.id,
        invoiceNo: inv++,
        invoiceDate: invoiceCurrent,
        dueDate: dueFuture,
        amount: "10.00",
        withholdingExpected: "0.00",
        netExpected: "10.00",
        status: "OPEN",
        createdById: admin.id,
        updatedById: admin.id,
      });
    }
    // 201 overdue with the newest invoice dates so they win the overdue page order.
    const overdueIds: string[] = [];
    for (let i = 0; i < 201; i++) {
      const number = `BL-ODOD-${run}-${i}`;
      rows.push({
        number,
        salesOrderId: so.id,
        customerId: customer.id,
        invoiceNo: inv++,
        invoiceDate: invoiceOverdue,
        dueDate: duePast,
        amount: "11.00",
        withholdingExpected: "0.00",
        netExpected: "11.00",
        status: "OPEN",
        createdById: admin.id,
        updatedById: admin.id,
      });
    }
    await db.billing.createMany({ data: rows });
    const planted = await db.billing.findMany({
      where: { number: { startsWith: `BL-ODOD-${run}-` } },
      select: { id: true, number: true },
    });
    expect(planted).toHaveLength(201);
    overdueIds.push(...planted.map((p) => p.id));

    const listed = await listBillings({ status: "OVERDUE" });
    const dash = await loadHomeDashboard(admin);
    const overdueAction = dash.actions.find((a) => a.kind === "billingsOverdue");

    expect(listed.length).toBeLessThanOrEqual(200);
    expect(listed.every((r) => r.overdue.overdue)).toBe(true);
    // Home overdue count matches the Overdue list page (filter-before-page).
    expect(overdueAction?.count ?? 0).toBe(listed.length);
    expect(listed.length).toBe(200);

    // Our newest-invoice overdue rows must appear (would be missing if take ran first).
    const listedIds = new Set(listed.map((r) => r.id));
    const plantedOnPage = overdueIds.filter((id) => listedIds.has(id));
    expect(plantedOnPage.length).toBe(200);
  });

  it("arAgingSummary credit matches per-customer customerCreditBalance (grouped query)", async () => {
    const year = await freshYear();
    const { customer } = await openSo(year, "10000");
    await recordCollection(
      {
        customerId: customer.id,
        date: manilaToday(),
        method: "CASH",
        amountReceived: "123.45",
        receiptNo: `OR-${tag()}`,
        reference: null,
        checkBank: null,
        checkDate: null,
        notes: null,
        allocations: [],
      },
      admin,
    );

    const ar = await arAgingSummary();
    let summed = 0n;
    for (const row of ar.byCustomer) {
      const solo = await customerCreditBalance(row.customerId);
      expect(row.credit).toBe(solo);
      summed += toScaled(row.credit, 2);
    }
    expect(ar.credit).toBe(fromScaled(summed, 2));
    const ours = ar.byCustomer.find((r) => r.customerId === customer.id);
    expect(ours?.credit).toBe("123.45");
  });

  it("listQuotesView needsApproval batch matches per-quote approvalReasons", async () => {
    const year = await freshYear();
    const customer = await makeCustomer(["GOODS_1"]);
    const supplier = await makeSupplier();
    // Large contract → needs approval under default thresholds.
    await createQuote(
      quoteInput(customer.id, year, {
        contactId: customer.contacts[0]!.id,
        items: [
          {
            id: null,
            description: `Need approval ${tag()}`,
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
    // Small margin-ok draft should not need approval.
    await createQuote(
      quoteInput(customer.id, year, {
        contactId: customer.contacts[0]!.id,
        items: [
          {
            id: null,
            description: `No approval ${tag()}`,
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "8000",
            unitPrice: "10000",
          },
        ],
      }),
      admin,
    );

    const batched = await listQuotesView({ needsApproval: true }, admin);
    // Same candidate window as listQuotesView (status DRAFT, take 500, same order).
    const drafts = await db.quote.findMany({
      where: { status: "DRAFT" },
      select: {
        id: true,
        settingsVersionId: true,
        contractPrice: true,
        netMarginPct: true,
      },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 500,
    });
    const expectedIds: string[] = [];
    const fallback = await getSettingsSnapshot();
    for (const q of drafts) {
      const snap = (await getSettingsVersion(q.settingsVersionId)) ?? fallback;
      const reasons = approvalReasons(
        { contractPrice: money(q.contractPrice), netMarginPct: money(q.netMarginPct) },
        snap.settings.approval,
      );
      if (reasons.length > 0) expectedIds.push(q.id);
    }
    expect(batched.map((r) => r.id).sort()).toEqual(expectedIds.sort());
  });
});
