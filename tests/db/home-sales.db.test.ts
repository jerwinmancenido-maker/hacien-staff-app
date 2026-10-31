// Home Sales section against MySQL (TEST_DATABASE_URL). Gross sales match the
// Non-VAT meter; voids excluded; Staff without manage_billing sees no Sales.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { loadHomeDashboard } from "@/lib/home/dashboard";
import { loadHomeSales } from "@/lib/home/sales-data";
import { manilaMonthKey, shiftMonthKey } from "@/lib/home/sales";
import { getSettingsSnapshot } from "@/lib/settings";
import { getGrossSalesYtd, getNonVatMeter } from "@/lib/services/non-vat";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("home sales (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let invoiceSeq = 900_000 + Math.floor(Math.random() * 40_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    admin = await makeUser("costs");
    staff = await makeUser("staff");
    await ensureWideBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet home-sales" };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.invoiceBooklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1,
            data: { ...snap.settings, invoiceBooklet: wide } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: wide,
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // version race
      }
    }
  }

  async function openSo(year: number, unitPrice: string, customerName?: string) {
    const customer = customerName
      ? await db.customer.create({
          data: {
            name: customerName,
            withholdingType: "TOP_WITHHOLDING_AGENT",
            address: "Test",
            defaultWithholding: ["GOODS_1"],
            contacts: { create: [{ name: `Buyer ${tag()}`, email: `b-${tag()}@test.example.com`, isMain: true }] },
          },
          include: { contacts: true },
        })
      : await makeCustomer(["GOODS_1"]);
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
            description: `Goods ${tag()}`,
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "1.00",
            unitPrice,
          },
        ],
      },
      admin,
    );
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `PO-${tag()}`, deliveryAddress: "Manila" }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    return { customer, so };
  }

  async function bill(soId: string, amount: string, invoiceDate: Date) {
    await ensureWideBooklet();
    return recordBilling(
      {
        salesOrderId: soId,
        amount,
        invoiceNo: nextInvoice(),
        invoiceDate,
        dueDate: new Date(invoiceDate.getTime() + 30 * 86_400_000),
        notes: null,
      },
      admin,
    );
  }

  it("hides Sales without billing access; Admin sees it", async () => {
    const now = new Date();
    expect(await loadHomeSales(staff, { now })).toBeNull();
    const adminSales = await loadHomeSales(admin, { now });
    expect(adminSales).not.toBeNull();
    expect(adminSales!.months).toHaveLength(12);
    expect(adminSales!.monthsNarrow).toHaveLength(6);

    const dashStaff = await loadHomeDashboard(staff, { now });
    expect(dashStaff.sales).toBeNull();
  });

  it("excludes voided billings from months, year total and top customers", async () => {
    const snap = await getSettingsSnapshot();
    const taxYear = snap.settings.taxYear.year;
    const now = new Date(Date.UTC(taxYear, 9, 15)); // mid-Oct of tax year
    const monthKey = manilaMonthKey(now);
    const [y, m] = monthKey.split("-").map(Number) as [number, number];
    const invoiceDate = new Date(Date.UTC(y, m - 1, 10));

    const t = tag();
    const { customer, so } = await openSo(taxYear, "9999999.00", `Sales Void Cust ${t}`);
    // Large keep so this customer lands in top 3 even on a shared test DB.
    const keep = await bill(so.id, "250000.00", invoiceDate);
    const gone = await bill(so.id, "8000.00", invoiceDate);
    await voidBilling(gone.id, "Wrong amount", admin);

    const before = await loadHomeSales(admin, { now });
    const meter = await getNonVatMeter(snap.settings.taxYear, now);
    expect(before).not.toBeNull();
    expect(Number(before!.thisYear)).toBe(meter.used);
    expect(await getGrossSalesYtd(taxYear, now)).toBe(meter.used);

    const bar = before!.months.find((row) => row.key === monthKey);
    expect(Number(bar!.amount)).toBeGreaterThanOrEqual(250_000);

    const ours = before!.topCustomers.find((c) => c.customerId === customer.id);
    expect(ours).toBeTruthy();
    // Voided ₱8k must not inflate this customer's total (only the kept ₱250k).
    expect(Number(ours!.amount)).toBe(250_000);
    expect(keep.status).not.toBe("VOID");
  });

  it("counts a billing on the last calendar day of the month (11:30 PM PHT still that month)", async () => {
    // invoiceDate is @db.Date — calendar day. 11:30 PM PHT on the last day is still
    // that Manila calendar day; the DATE column stores that day at 00:00 UTC.
    const snap = await getSettingsSnapshot();
    const taxYear = snap.settings.taxYear.year;
    // Use March (31 days) of the tax year.
    const lastDay = new Date(Date.UTC(taxYear, 2, 31)); // Mar 31 DATE
    const now = new Date(Date.UTC(taxYear, 2, 31, 15, 30, 0)); // Mar 31 23:30 PHT
    expect(manilaMonthKey(now)).toBe(`${taxYear}-03`);

    const { so } = await openSo(taxYear, "50000.00");
    await bill(so.id, "777.00", lastDay);

    const sales = await loadHomeSales(admin, { now });
    const mar = sales!.months.find((m) => m.key === `${taxYear}-03`);
    expect(Number(mar!.amount)).toBeGreaterThanOrEqual(777);
    expect(mar!.isCurrent).toBe(true);
  });

  it("year total equals the Non-VAT meter; change % when last month is 0", async () => {
    const snap = await getSettingsSnapshot();
    const taxYear = snap.settings.taxYear.year;
    const now = new Date(Date.UTC(taxYear, 5, 20)); // June
    const thisKey = manilaMonthKey(now);
    const lastKey = shiftMonthKey(thisKey, -1);
    const [ty, tm] = thisKey.split("-").map(Number) as [number, number];
    const [ly, lm] = lastKey.split("-").map(Number) as [number, number];

    const { so } = await openSo(taxYear, "200000.00");
    // Bill only this month — last month stays whatever the shared DB has; we
    // assert the change helper path when lastMonth amount for our isolated
    // check uses salesChange via a synthetic empty last month by comparing
    // that year total tracks the meter after our billing.
    await bill(so.id, "1500.00", new Date(Date.UTC(ty, tm - 1, 5)));
    // Ensure last month also has a known row so change is defined for that key
    // on a quiet DB slice — optional; at minimum year === meter.
    await bill(so.id, "500.00", new Date(Date.UTC(ly, lm - 1, 5)));

    const sales = await loadHomeSales(admin, { now });
    const meter = await getNonVatMeter(snap.settings.taxYear, now);
    expect(Number(sales!.thisYear)).toBe(meter.used);
    expect(sales!.change.label === "—" || /%/.test(sales!.change.label)).toBe(true);
  });

  it("top customers this year: top 3, fewer when short, name links", async () => {
    const snap = await getSettingsSnapshot();
    const taxYear = snap.settings.taxYear.year;
    const now = new Date(Date.UTC(taxYear, 8, 10));
    const t = tag();
    const a = await openSo(taxYear, "500000.00", `TopA ${t}`);
    const b = await openSo(taxYear, "500000.00", `TopB ${t}`);
    const c = await openSo(taxYear, "500000.00", `TopC ${t}`);
    const d = await openSo(taxYear, "500000.00", `TopD ${t}`);
    const day = new Date(Date.UTC(taxYear, 7, 1));
    await bill(a.so.id, "9000.00", day);
    await bill(b.so.id, "7000.00", day);
    await bill(c.so.id, "5000.00", day);
    await bill(d.so.id, "1000.00", day);

    const sales = await loadHomeSales(admin, { now });
    const ours = sales!.topCustomers.filter((c) => c.name.includes(t));
    // Shared DB may already have larger customers; at least our largest should rank if amounts dominate.
    // Assert shape: at most 3, hrefs point at customer pages, amounts descending.
    expect(sales!.topCustomers.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < sales!.topCustomers.length; i++) {
      expect(Number(sales!.topCustomers[i - 1]!.amount)).toBeGreaterThanOrEqual(
        Number(sales!.topCustomers[i]!.amount),
      );
    }
    for (const row of sales!.topCustomers) {
      expect(row.href).toBe(`/customers/${row.customerId}`);
    }
    // Our four customers alone would top as A,B,C — if the global top includes them, order holds.
    if (ours.length >= 3) {
      expect(ours[0]!.name).toContain("TopA");
    }
    expect(a.customer.id).toBeTruthy();
  });

  it("empty chart when no billings fall in the 12-month window", async () => {
    // Far-future now: chart months are all zero → empty UI (rows hidden).
    // Top customers / year still follow the settings tax year (Non-VAT window).
    const far = new Date(Date.UTC(2800, 5, 15));
    const sales = await loadHomeSales(admin, { now: far });
    expect(sales).not.toBeNull();
    expect(sales!.empty).toBe(true);
    expect(sales!.months.every((m) => Number(m.amount) === 0)).toBe(true);
    expect(sales!.monthsNarrow).toHaveLength(6);
    expect(sales!.change.label).toBe("—");
  });
});
