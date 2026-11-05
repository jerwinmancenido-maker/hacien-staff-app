// Audit A: an SO closes itself when fully billed, paid and delivered,
// and reopens when a later change breaks that. Runs on MySQL 8
// (TEST_DATABASE_URL); skipped locally.

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
import { money } from "@/lib/documents/common";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import { recordDelivery, voidDelivery } from "@/lib/services/deliveries";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet SO close" };
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

describe.skipIf(!env.hasDb)("SO auto-close (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 800_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 950_000 + Math.floor(Math.random() * 40_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-so-close-uploads-"));
    admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
    await ensureWideDrBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** One SO: 10 pcs at ₱100 = ₱1,000 contract, no withholding. */
  async function makeOpenSo(year: number) {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Widget A",
            kind: "GOODS",
            qty: "10",
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
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddressId }, admin);
    const soWithItems = await db.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { items: true },
    });
    return { customer, so, itemId: soWithItems.items[0]!.id };
  }

  async function statusOf(soId: string) {
    const row = await db.salesOrder.findUniqueOrThrow({ where: { id: soId }, select: { status: true } });
    return row.status;
  }

  /** Bill the full contract and collect it in full (cash + any withholding). Returns the billing. */
  async function billAndPay(customerId: string, soId: string, year: number) {
    const soRow = await db.salesOrder.findUniqueOrThrow({
      where: { id: soId },
      select: { contractPrice: true, withholdingTotal: true },
    });
    // Cash is the contract less the withholding the customer withholds;
    // the withholding itself counts as paid through the 2307 allocation.
    const wh = money(soRow.withholdingTotal);
    const cash = fromScaled(toScaled(money(soRow.contractPrice), 2) - toScaled(wh, 2), 2);
    const billing = await recordBilling(
      {
        salesOrderId: soId,
        amount: money(soRow.contractPrice),
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    const collection = await recordCollection(
      {
        customerId,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "BANK_TRANSFER",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-${year}-${nextInvoice()}`,
        amountReceived: cash,
        notes: null,
        allocations: [{ billingId: billing.id, cashApplied: cash, withholdingApplied: wh }],
      },
      admin,
    );
    return { billing, collection };
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

  it("closes when fully billed, paid and delivered; reopens when the delivery is voided", async () => {
    const year = await freshYear();
    const { customer, so, itemId } = await makeOpenSo(year);
    expect(await statusOf(so.id)).toBe("OPEN");

    await billAndPay(customer.id, so.id, year);
    // Money complete, but nothing delivered yet.
    expect(await statusOf(so.id)).toBe("OPEN");

    const delivery = await deliver(so.id, itemId, "10.00");
    expect(await statusOf(so.id)).toBe("CLOSED");

    await voidDelivery(delivery.id, "Wrong items sent", admin);
    expect(await statusOf(so.id)).toBe("OPEN");
  });

  it("closed SO refuses new billing and new delivery", async () => {
    const year = await freshYear();
    const { customer, so, itemId } = await makeOpenSo(year);
    await billAndPay(customer.id, so.id, year);
    await deliver(so.id, itemId, "10.00");
    expect(await statusOf(so.id)).toBe("CLOSED");

    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "1.00",
          invoiceNo: nextInvoice(),
          invoiceDate: new Date(Date.UTC(year, 2, 5)),
          dueDate: new Date(Date.UTC(year, 3, 4)),
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/Only open sales orders can be billed/);
    await expect(deliver(so.id, itemId, "1.00")).rejects.toThrow(/closed or void/);
    // Still closed after the refused attempts.
    expect(await statusOf(so.id)).toBe("CLOSED");
  });

  it("voiding the collection reopens a closed SO", async () => {
    const year = await freshYear();
    const { customer, so, itemId } = await makeOpenSo(year);
    const { collection } = await billAndPay(customer.id, so.id, year);
    await deliver(so.id, itemId, "10.00");
    expect(await statusOf(so.id)).toBe("CLOSED");

    await voidCollection(collection.id, "Payment reversed", admin);
    expect(await statusOf(so.id)).toBe("OPEN");
  });

  it("partial delivery keeps the SO open", async () => {
    const year = await freshYear();
    const { customer, so, itemId } = await makeOpenSo(year);
    await billAndPay(customer.id, so.id, year);
    await deliver(so.id, itemId, "5.00");
    expect(await statusOf(so.id)).toBe("OPEN");
  });
});
