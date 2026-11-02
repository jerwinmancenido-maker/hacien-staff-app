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
import { getBookletView } from "@/lib/billing/views";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("BIR booklet tracking & spoiled numbers (MySQL)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-booklet-uploads-"));
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

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

    // Record billing with serial 101
    const b1 = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "500.00",
        invoiceNo: 101,
        invoiceDate: d,
        dueDate: d,
        notes: null,
      },
      admin,
    );
    expect(b1.invoiceNo).toBe(101);

    // Attempting duplicate 101 throws error
    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo: 101,
          invoiceDate: d,
          dueDate: d,
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/already used \/ marked spoiled/);

    // Void b1
    await voidBilling(b1.id, "Void test", admin);

    // Number 101 remains used even after void
    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo: 101,
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

    // Mark 107 spoiled
    const spoiled = await markBookletNumberSpoiled(
      {
        type: "SI",
        number: 107,
        reason: "Printer jam torn sheet",
      },
      admin,
      [{ name: "jam.png", size: dummyPng.length, bytes: dummyPng }],
    );
    expect(spoiled.number).toBe(107);
    expect(spoiled.type).toBe("SI");

    // Attempting to record billing with spoiled 107 is blocked
    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo: 107,
          invoiceDate: d,
          dueDate: d,
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/SI no\. 107 is already used \/ marked spoiled/);
  });

  it("next-free skips used and spoiled numbers without skipping serials", async () => {
    const view = await getBookletView("SI");
    // Next free is a valid number in range
    expect(view.nextFree).toBeGreaterThanOrEqual(view.range.seriesFrom);
    expect(view.nextFree).toBeLessThanOrEqual(view.range.seriesTo);
  });
});
