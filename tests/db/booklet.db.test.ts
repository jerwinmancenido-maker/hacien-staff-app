// Booklet tracking & spoiled numbers against MySQL 8 (TEST_DATABASE_URL).

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
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { markBookletNumberSpoiled } from "@/lib/services/booklet";
import { recordDelivery, voidDelivery } from "@/lib/services/deliveries";
import { getBookletView } from "@/lib/billing/views";
import { getSettingsSnapshot } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("BIR booklet tracking & spoiled numbers (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 800_000;

  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-booklet-uploads-"));
    admin = await makeUser("costs");
    await ensureWideBooklet();
    const [maxBilling, maxSpoiled] = await Promise.all([
      db.billing.aggregate({ _max: { invoiceNo: true } }),
      db.spoiledBookletNumber.aggregate({ _max: { number: true } }),
    ]);
    invoiceSeq =
      Math.max(800_000, Number(maxBilling._max.invoiceNo ?? 0), Number(maxSpoiled._max.number ?? 0)) +
      Math.floor(Math.random() * 100);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
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
    const wide = {
      seriesFrom: 1,
      seriesTo: 9_999_999,
      label: "Test booklet Q09",
      salesInvoice: { ...typeWide },
      deliveryReceipt: { ...typeWide },
      collectionReceipt: { ...typeWide },
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      const ib = snap.settings.invoiceBooklet;
      if (
        (ib.salesInvoice?.seriesTo ?? ib.seriesTo) >= 9_999_999 &&
        (ib.deliveryReceipt?.seriesTo ?? 0) >= 9_999_999 &&
        (ib.collectionReceipt?.seriesTo ?? 0) >= 9_999_999
      ) {
        return;
      }
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1,
            data: { ...(latest.data as object), invoiceBooklet: { ...ib, ...wide } } as never,
            changedKey: "invoiceBooklet",
            before: ib,
            after: wide,
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // Unique version race — retry.
      }
    }
  }

  async function openSo(year: number) {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const addressId = await customerDeliveryAddressId(customer.id);
    const quote = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        terms: "COD",
        notes: null,
        items: [
          {
            id: null,
            description: "Test Item",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "500.00",
            unitPrice: "1000.00",
          },
        ],
      },
      admin,
    );
    const approved = await approveQuote(quote.id, admin);
    const so = await convertQuoteToSalesOrder(approved.id, { deliveryAddressId: addressId }, admin);
    return { customer, so };
  }

  // PNG magic bytes
  const dummyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

  it("blocks duplicate SI numbers and voided numbers stay used", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const d = new Date(`${year}-06-01T00:00:00.000Z`);
    const inv = nextInvoice();

    const b1 = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "500.00",
        invoiceNo: inv,
        invoiceDate: d,
        dueDate: d,
        notes: null,
      },
      admin,
    );
    expect(b1.invoiceNo).toBe(inv);

    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo: inv,
          invoiceDate: d,
          dueDate: d,
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/already used \/ marked spoiled/);

    await voidBilling(b1.id, "Void test", admin);

    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo: inv,
          invoiceDate: d,
          dueDate: d,
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/already used \/ marked spoiled/);
  });

  it("marks a number spoiled with photo and blocks reuse in billing", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const d = new Date(`${year}-06-01T00:00:00.000Z`);
    const inv = nextInvoice();

    const spoiled = await markBookletNumberSpoiled(
      {
        type: "SI",
        number: inv,
        reason: "Printer jam torn sheet",
      },
      admin,
      [{ name: "jam.png", size: dummyPng.length, bytes: dummyPng }],
    );
    expect(spoiled.number).toBe(inv);
    expect(spoiled.type).toBe("SI");

    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo: inv,
          invoiceDate: d,
          dueDate: d,
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/already used \/ marked spoiled/);
  });

  it("next-free skips used and spoiled numbers without skipping serials", async () => {
    const view = await getBookletView("SI");
    expect(view.nextFree).toBeGreaterThanOrEqual(view.range.seriesFrom);
    expect(view.nextFree).toBeLessThanOrEqual(view.range.seriesTo);
  });

  it("refuses out-of-range SI numbers with a plain message", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const d = new Date(`${year}-06-01T00:00:00.000Z`);
    const snap = await getSettingsSnapshot();
    const to = snap.settings.invoiceBooklet.salesInvoice?.seriesTo ?? snap.settings.invoiceBooklet.seriesTo;
    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo: to + 1,
          invoiceDate: d,
          dueDate: d,
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/outside the booklet range/);
  });

  it("concurrent billings never share the same SI number", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const d = new Date(`${year}-06-01T00:00:00.000Z`);
    const other = await makeUser("costs");
    const invoiceNo = nextInvoice();
    const input = {
      salesOrderId: so.id,
      amount: "100.00",
      invoiceNo,
      invoiceDate: d,
      dueDate: d,
      notes: null as string | null,
    };
    const results = await Promise.allSettled([recordBilling(input, admin), recordBilling(input, other)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as PromiseRejectedResult).reason.message).toMatch(/already used \/ marked spoiled/);
    const rows = await db.billing.findMany({ where: { invoiceNo } });
    expect(rows).toHaveLength(1);
  });

  it("refuses duplicate DR serials including after void", async () => {
    const year = await freshYear();
    const a = await openSo(year);
    const b = await openSo(year);
    const soA = await db.salesOrder.findUniqueOrThrow({
      where: { id: a.so.id },
      include: { items: { where: { removedAt: null } } },
    });
    const soB = await db.salesOrder.findUniqueOrThrow({
      where: { id: b.so.id },
      include: { items: { where: { removedAt: null } } },
    });
    const drNo = String(nextInvoice());
    const del = await recordDelivery(
      a.so.id,
      {
        drNumber: drNo,
        deliveryDate: new Date(Date.UTC(year, 5, 1)),
        idSightChecked: false,
        items: [{ salesOrderItemId: soA.items[0]!.id, qty: "1" }],
      },
      admin,
    );
    await expect(
      recordDelivery(
        b.so.id,
        {
          drNumber: drNo,
          deliveryDate: new Date(Date.UTC(year, 5, 2)),
          idSightChecked: false,
          items: [{ salesOrderItemId: soB.items[0]!.id, qty: "1" }],
        },
        admin,
      ),
    ).rejects.toThrow(/already used \/ marked spoiled/);
    await voidDelivery(del.id, "Wrong DR", admin);
    await expect(
      recordDelivery(
        b.so.id,
        {
          drNumber: `DR-${drNo}`,
          deliveryDate: new Date(Date.UTC(year, 5, 3)),
          idSightChecked: false,
          items: [{ salesOrderItemId: soB.items[0]!.id, qty: "1" }],
        },
        admin,
      ),
    ).rejects.toThrow(/already used \/ marked spoiled/);
  });

  it("concurrent spoil and billing of the same SI: exactly one wins", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const d = new Date(`${year}-06-01T00:00:00.000Z`);
    const invoiceNo = nextInvoice();
    const results = await Promise.allSettled([
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo,
          invoiceDate: d,
          dueDate: d,
          notes: null,
        },
        admin,
      ),
      markBookletNumberSpoiled(
        { type: "SI", number: invoiceNo, reason: "Torn sheet during concurrent test" },
        admin,
        [{ name: "jam.png", size: dummyPng.length, bytes: dummyPng }],
      ),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    const billing = await db.billing.findFirst({ where: { invoiceNo } });
    const spoiled = await db.spoiledBookletNumber.findFirst({ where: { type: "SI", number: invoiceNo } });
    expect([billing, spoiled].filter(Boolean)).toHaveLength(1);
  });
});
