// Home count cards (ERP adoption item 9) against MySQL 8 (TEST_DATABASE_URL).
// Pins: Orders to deliver = the SO list's own "Still to deliver" total;
// Open sales orders = every own-company OPEN SO; cash balances reuse
// cashPositionSummary and sit behind the dashboard money gate.

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
import { loadHomeDashboard } from "@/lib/home/dashboard";
import { listSalesOrdersPageView } from "@/lib/quotes/views";
import { cashPositionSummary, createCashAccount } from "@/lib/services/cash-accounts";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordDelivery } from "@/lib/services/deliveries";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput, tag } from "./fixtures";

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

describe.skipIf(!env.hasDb)("home count cards (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let viewer: DocActor;
  let drSeq = 880_000 + Math.floor(Math.random() * 10_000);
  const nextDr = () => String(++drSeq);
  let prevCashEnabled: string | undefined;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-home-counts-uploads-"));
    prevCashEnabled = process.env.CASH_ENABLED;
    process.env.CASH_ENABLED = "true";
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    await ensureWideDrBooklet(admin.id);
  });

  afterAll(async () => {
    if (prevCashEnabled === undefined) delete process.env.CASH_ENABLED;
    else process.env.CASH_ENABLED = prevCashEnabled;
    await db.$disconnect();
  });

  async function makeSo(year: number, buyerPoNo: string, qty: string) {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: `Counts goods ${tag()}`,
            kind: "GOODS" as const,
            qty,
            unit: "pcs",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "100",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo, deliveryAddressId }, admin);
    const item = await db.salesOrderItem.findFirstOrThrow({
      where: { salesOrderId: so.id },
      orderBy: { sortOrder: "asc" },
    });
    return { so, item };
  }

  async function deliver(soId: string, itemId: string, qty: string) {
    return recordDelivery(
      soId,
      {
        drNumber: nextDr(),
        deliveryDate: new Date(),
        idSightChecked: false,
        items: [{ salesOrderItemId: itemId, qty }],
      },
      admin,
    );
  }

  it("counts follow the SO lifecycle and match their linked lists exactly", async () => {
    const year = await freshYear();
    const base = (await loadHomeDashboard(admin)).counts;
    expect(base.ordersToDeliver).not.toBeNull();
    expect(base.openSalesOrders).not.toBeNull();
    const baseDeliver = base.ordersToDeliver!.count;
    const baseOpen = base.openSalesOrders!.count;
    expect(base.ordersToDeliver!.href).toBe("/sales-orders?toDeliver=1&business=own");
    expect(base.openSalesOrders!.href).toBe("/sales-orders?status=OPEN&business=own");
    expect(base.ordersToDeliver!.label).toBe("Orders to deliver");
    expect(base.openSalesOrders!.label).toBe("Open sales orders");

    // New undelivered order: both counts +1.
    const { so, item } = await makeSo(year, `HC-${tag()}`, "10");
    let counts = (await loadHomeDashboard(admin)).counts;
    expect(counts.openSalesOrders!.count).toBe(baseOpen + 1);
    expect(counts.ordersToDeliver!.count).toBe(baseDeliver + 1);

    // Partial delivery: still to deliver, still open.
    await deliver(so.id, item.id, "4");
    counts = (await loadHomeDashboard(admin)).counts;
    expect(counts.openSalesOrders!.count).toBe(baseOpen + 1);
    expect(counts.ordersToDeliver!.count).toBe(baseDeliver + 1);

    // Fully delivered (unbilled, so still OPEN): drops off to-deliver only.
    await deliver(so.id, item.id, "6");
    counts = (await loadHomeDashboard(admin)).counts;
    expect(counts.openSalesOrders!.count).toBe(baseOpen + 1);
    expect(counts.ordersToDeliver!.count).toBe(baseDeliver);

    // Another business's order never counts (entity wall, both figures).
    const other = await makeSo(year, `HC-${tag()}`, "2");
    const biz = await db.business.create({ data: { name: `Other Biz ${tag()}`, shortLabel: `OB${tag().slice(0, 4)}` } });
    await db.salesOrder.update({ where: { id: other.so.id }, data: { businessId: biz.id } });
    counts = (await loadHomeDashboard(admin)).counts;
    expect(counts.openSalesOrders!.count).toBe(baseOpen + 1);
    expect(counts.ordersToDeliver!.count).toBe(baseDeliver);

    // VOID leaves the open count.
    await db.salesOrder.update({ where: { id: so.id }, data: { status: "VOID" } });
    counts = (await loadHomeDashboard(admin)).counts;
    expect(counts.openSalesOrders!.count).toBe(baseOpen);
    expect(counts.ordersToDeliver!.count).toBe(baseDeliver);

    // Parity: each card equals the source its link opens, read back-to-back.
    const finalCounts = (await loadHomeDashboard(admin)).counts;
    const listTotal = (await listSalesOrdersPageView({ toDeliver: true, businessId: "own" }, 1, 1)).total;
    const dbOpen = await db.salesOrder.count({ where: { status: "OPEN", businessId: null } });
    expect(finalCounts.ordersToDeliver!.count).toBe(listTotal);
    expect(finalCounts.openSalesOrders!.count).toBe(dbOpen);
  });

  it("cash balances reuse the Cash position and hide behind the money gate", async () => {
    await makeCustomer(); // Home leaves the getting-started state.
    const t = tag();
    const account = await createCashAccount(
      {
        name: `Counts Bank ${t}`,
        type: "BANK",
        bankName: "Test Bank",
        accountHintLast4: "4242",
        openingBalance: "2500.00",
        openingDate: new Date(Date.UTC(2026, 0, 1)),
        active: true,
      },
      admin,
    );

    const adminDash = await loadHomeDashboard(admin);
    const row = adminDash.counts.cashBalances.find((r) => r.id === account.id);
    expect(row).toBeDefined();
    expect(row!.name).toBe(`Counts Bank ${t}`);
    expect(row!.balance).toBe("2500.00");
    expect(row!.href).toBe(`/cash/accounts/${account.id}`);
    expect(row!.detail).toBe("Bank account · ···4242");

    // Every balance on Home is a row of the Cash position, same figures.
    const position = await cashPositionSummary();
    expect(adminDash.counts.cashBalances.map((r) => r.id)).toEqual(position.accounts.map((a) => a.id));
    for (const r of adminDash.counts.cashBalances) {
      expect(r.balance).toBe(position.accounts.find((a) => a.id === r.id)!.balance);
    }
    if (Number(position.unassignedNet) !== 0) {
      expect(adminDash.counts.unassignedCash).toEqual({ balance: position.unassignedNet, href: "/cash" });
    } else {
      expect(adminDash.counts.unassignedCash).toBeNull();
    }

    // Staff / Viewer: counts yes, balances no (the KPI money gate).
    for (const u of [staff, viewer]) {
      const dash = await loadHomeDashboard(u);
      expect(dash.counts.ordersToDeliver).not.toBeNull();
      expect(dash.counts.openSalesOrders).not.toBeNull();
      expect(dash.counts.cashBalances).toEqual([]);
      expect(dash.counts.unassignedCash).toBeNull();
    }

    // Cash feature off: even Admin sees no balances.
    const prev = process.env.CASH_ENABLED;
    process.env.CASH_ENABLED = "false";
    try {
      const dash = await loadHomeDashboard(admin);
      expect(dash.counts.cashBalances).toEqual([]);
      expect(dash.counts.unassignedCash).toBeNull();
    } finally {
      process.env.CASH_ENABLED = prev;
    }
  });
});
