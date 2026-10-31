// Non-VAT gross sales from Part 5 billings against MySQL 8 (TEST_DATABASE_URL).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { money } from "@/lib/documents/common";
import { getSettingsSnapshot } from "@/lib/settings";
import {
  billingsGrossSales,
  getGrossSalesYtd,
  getNonVatMeter,
  nonVatMeter,
  taxYearStart,
} from "@/lib/services/non-vat";
import { convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection } from "@/lib/services/collections";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("non-VAT gross sales from billings (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 800_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    admin = await makeUser("costs");
    await ensureWideBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Parallel DB suites can publish a newer settings version with the default 1–500 booklet. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet non-vat" };
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
        // Unique version race with another suite — retry.
      }
    }
  }

  async function openSo(year: number, unitPrice: string) {
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

  async function bill(
    soId: string,
    amount: string,
    invoiceDate: Date,
    dueDate = new Date(invoiceDate.getTime() + 30 * 86_400_000),
  ) {
    await ensureWideBooklet();
    return recordBilling(
      {
        salesOrderId: soId,
        amount,
        invoiceNo: nextInvoice(),
        invoiceDate,
        dueDate,
        notes: null,
      },
      admin,
    );
  }

  it("excludes voided billings and includes open ones", async () => {
    const year = await freshYear();
    const { so } = await openSo(year, "100000.00");
    const keep = await bill(so.id, "40000.00", new Date(Date.UTC(year, 5, 15)));
    const gone = await bill(so.id, "25000.00", new Date(Date.UTC(year, 5, 16)));
    await voidBilling(gone.id, "Wrong amount", admin);

    const now = new Date(Date.UTC(year, 11, 1));
    expect(await getGrossSalesYtd(year, now, billingsGrossSales)).toBe(40_000);
    expect(keep.status).not.toBe("VOID");
  });

  it("still counts PAID and PARTIALLY_PAID billings toward gross sales", async () => {
    const year = await freshYear();
    const { so } = await openSo(year, "100000.00");
    const open = await bill(so.id, "10000.00", new Date(Date.UTC(year, 2, 1)));
    const partial = await bill(so.id, "20000.00", new Date(Date.UTC(year, 2, 2)));
    const paid = await bill(so.id, "30000.00", new Date(Date.UTC(year, 2, 3)));
    await db.billing.update({ where: { id: partial.id }, data: { status: "PARTIALLY_PAID" } });
    await db.billing.update({ where: { id: paid.id }, data: { status: "PAID" } });
    expect(open.status).toBe("OPEN");
    expect((await db.billing.findUniqueOrThrow({ where: { id: partial.id } })).status).toBe("PARTIALLY_PAID");
    expect((await db.billing.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("PAID");

    const now = new Date(Date.UTC(year, 8, 1));
    // status !== VOID only — payment progress must not shrink gross sales.
    expect(await getGrossSalesYtd(year, now, billingsGrossSales)).toBe(60_000);
  });

  it("counts a billing dated today when now is 01:00 PHT (DATE at 00:00 UTC)", async () => {
    // Billing.invoiceDate is @db.Date → stored as 00:00 UTC of that calendar day.
    // At 01:00 PHT, that DATE instant is still later than `now` on the UTC clock;
    // YTD must extend through the end of the current PHT day so it still counts.
    const year = await freshYear();
    const { so } = await openSo(year, "50000.00");
    const todayDate = new Date(Date.UTC(year, 5, 15)); // June 15 DATE
    await bill(so.id, "33333.00", todayDate);
    const now = new Date(Date.UTC(year, 5, 14, 17, 0, 0)); // June 15 01:00 PHT

    expect(await getGrossSalesYtd(year, now, billingsGrossSales)).toBe(33_333);
  });

  it("uses Manila tax-year boundaries (Dec 31 23:59 PHT vs Jan 1 00:00 PHT)", async () => {
    // freshYear reserves base and base+1 so neither year is shared with other suites.
    // Tax year Y=base+1: [Jan 1 00:00 PHT Y, Jan 1 00:00 PHT Y+1).
    // DATE columns store calendar days at 00:00 UTC; Dec 31 of base is last year,
    // Jan 1 of Y is the first day of the tax year (matches taxYearStart / PHT midnight).
    const base = await freshYear();
    const year = base + 1;
    const { so: soPrev } = await openSo(base, "50000.00");
    const { so: soCurr } = await openSo(year, "50000.00");

    await bill(soPrev.id, "11111.00", new Date(Date.UTC(base, 11, 31))); // Dec 31 23:59 PHT still that calendar day
    await bill(soCurr.id, "22222.00", new Date(Date.UTC(year, 0, 1))); // Jan 1 00:00 PHT calendar day

    expect(taxYearStart(year).toISOString()).toBe(`${base}-12-31T16:00:00.000Z`);

    const midYear = new Date(Date.UTC(year, 6, 1));
    expect(await getGrossSalesYtd(year, midYear, billingsGrossSales)).toBe(22_222);
    // Prior tax year ends at Jan 1 00:00 PHT of `year` (= Dec 31 16:00 UTC of `base`).
    expect(await getGrossSalesYtd(base, taxYearStart(year), billingsGrossSales)).toBe(11_111);

    const from = taxYearStart(year);
    const to = taxYearStart(year + 1);
    expect(await billingsGrossSales.grossSalesBetween(from, to)).toBe(22_222);
  });

  it("sums billings across multiple customers", async () => {
    const year = await freshYear();
    const a = await openSo(year, "30000.00");
    const b = await openSo(year, "30000.00");
    await bill(a.so.id, "10000.00", new Date(Date.UTC(year, 3, 10)));
    await bill(b.so.id, "15000.50", new Date(Date.UTC(year, 3, 11)));

    const now = new Date(Date.UTC(year, 8, 1));
    expect(await getGrossSalesYtd(year, now, billingsGrossSales)).toBe(25_000.5);
  });

  it("counts full billing amount even when 2307 withholding is applied on collection", async () => {
    const year = await freshYear();
    const { customer, so } = await openSo(year, "10000.00");
    const billing = await bill(so.id, "10000.00", new Date(Date.UTC(year, 4, 5)));
    expect(money(billing.withholdingExpected)).not.toBe("0.00");

    await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 4, 6)),
        method: "BANK_TRANSFER",
        reference: `REF-${tag()}`,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-${tag()}`,
        amountReceived: "9900.00",
        notes: null,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "9900.00",
            withholdingApplied: "100.00",
            withholdingRate: "0.0100",
            atcCode: "WC010",
          },
        ],
      },
      admin,
    );

    const now = new Date(Date.UTC(year, 5, 1));
    // Gross is the booklet total (₱10,000), not net of 2307 / cash.
    expect(await getGrossSalesYtd(year, now, billingsGrossSales)).toBe(10_000);
  });

  it("drives meter levels ok / first / second / over from real billings", async () => {
    const year = await freshYear();
    // Limit 1_000_000 → first at 700k, second at 900k, over at 1M.
    const taxYear = { year, nonVatLimit: 1_000_000, warnFirstPct: 70, warnSecondPct: 90 };
    const { so } = await openSo(year, "2000000.00");
    const now = new Date(Date.UTC(year, 9, 15));

    await bill(so.id, "500000.00", new Date(Date.UTC(year, 3, 1)));
    let meter = await getNonVatMeter(taxYear, now, billingsGrossSales);
    expect(meter.level).toBe("ok");
    expect(meter.used).toBe(500_000);

    await bill(so.id, "200000.00", new Date(Date.UTC(year, 4, 1))); // 700k
    meter = await getNonVatMeter(taxYear, now, billingsGrossSales);
    expect(meter.level).toBe("first");
    expect(meter.used).toBe(700_000);

    await bill(so.id, "200000.00", new Date(Date.UTC(year, 5, 1))); // 900k
    meter = await getNonVatMeter(taxYear, now, billingsGrossSales);
    expect(meter.level).toBe("second");
    expect(meter.used).toBe(900_000);

    await bill(so.id, "100000.00", new Date(Date.UTC(year, 6, 1))); // 1M
    meter = await getNonVatMeter(taxYear, now, billingsGrossSales);
    expect(meter.level).toBe("over");
    expect(meter.used).toBe(1_000_000);

    // Pure helper agrees.
    expect(nonVatMeter(699_999, taxYear).level).toBe("ok");
    expect(nonVatMeter(700_000, taxYear).level).toBe("first");
    expect(nonVatMeter(900_000, taxYear).level).toBe("second");
    expect(nonVatMeter(1_000_000, taxYear).level).toBe("over");
  });
});
