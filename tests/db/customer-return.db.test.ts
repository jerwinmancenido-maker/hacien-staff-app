// Audit D: customer return / credit memo. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

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
import { applyCreditSimple, customerCreditBalance } from "@/lib/services/collections";
import { postCustomerReturn, voidCustomerReturn } from "@/lib/services/customer-returns";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet return" };
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

describe.skipIf(!env.hasDb)("customer return / credit memo (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 860_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 970_000 + Math.floor(Math.random() * 30_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-return-uploads-"));
    admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
    await ensureWideDrBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeDeliveredSo(year: number) {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Widget A",
            kind: "GOODS",
            qty: "2",
            unit: "pc",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "500",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddressId }, admin);
    const soWithItems = await db.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { items: true },
    });
    const itemId = soWithItems.items[0]!.id;
    await recordDelivery(
      so.id,
      {
        drNumber: nextDr(),
        deliveryDate: new Date(),
        idSightChecked: false,
        items: [{ salesOrderItemId: itemId, qty: "2.00" }],
      },
      admin,
    );
    const billing = await recordBilling(
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
    return { customer, so, itemId, billing };
  }

  async function deliveredQty(itemId: string) {
    const item = await db.salesOrderItem.findUniqueOrThrow({ where: { id: itemId } });
    // Decimal toString strips trailing zeros ("1"), so format to 2dp like
    // the rest of the suite does (receivedQty.toFixed(2)).
    return item.deliveredQty.toFixed(2);
  }

  it("a return reduces deliveredQty and creates credit for the returned value", async () => {
    const year = await freshYear();
    const { customer, so, itemId } = await makeDeliveredSo(year);
    const ret = await postCustomerReturn(
      so.id,
      { returnDate: new Date(Date.UTC(year, 2, 10)), reason: "Defective", lines: [{ lineId: itemId, qty: "1" }] },
      admin,
    );
    expect(ret.number).toMatch(/^CM-\d{4}-\d{4}$/);
    expect(await deliveredQty(itemId)).toBe("1.00");
    expect(await customerCreditBalance(customer.id)).toBe("500.00");
  });

  it("a return cannot exceed what was delivered", async () => {
    const year = await freshYear();
    const { so, itemId } = await makeDeliveredSo(year);
    await expect(
      postCustomerReturn(
        so.id,
        { returnDate: new Date(Date.UTC(year, 2, 10)), reason: null, lines: [{ lineId: itemId, qty: "3" }] },
        admin,
      ),
    ).rejects.toThrow(/Fix the quantities marked below/);
    expect(await deliveredQty(itemId)).toBe("2.00");
  });

  it("return credit applies to an open billing and pays it", async () => {
    const year = await freshYear();
    const { customer, so, itemId, billing } = await makeDeliveredSo(year);
    await postCustomerReturn(
      so.id,
      { returnDate: new Date(Date.UTC(year, 2, 10)), reason: null, lines: [{ lineId: itemId, qty: "2" }] },
      admin,
    );
    expect(await customerCreditBalance(customer.id)).toBe("1000.00");
    await applyCreditSimple(customer.id, billing.id, "1000.00", admin);
    const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after.status).toBe("PAID");
    expect(await customerCreditBalance(customer.id)).toBe("0.00");
  });

  it("voiding a return restores deliveredQty and reverses applied credit", async () => {
    const year = await freshYear();
    const { customer, so, itemId, billing } = await makeDeliveredSo(year);
    const ret = await postCustomerReturn(
      so.id,
      { returnDate: new Date(Date.UTC(year, 2, 10)), reason: null, lines: [{ lineId: itemId, qty: "2" }] },
      admin,
    );
    await applyCreditSimple(customer.id, billing.id, "1000.00", admin);
    await voidCustomerReturn(ret.id, "Wrong item returned", admin);
    expect(await deliveredQty(itemId)).toBe("2.00");
    const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after.status).toBe("OPEN");
    expect(await customerCreditBalance(customer.id)).toBe("0.00");
  });
});
