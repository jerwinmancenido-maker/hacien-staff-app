// Fix batch 2 (2026-11-19): F14 — the AR aging summary ignored
// return-credit applications.
// Mac run Block 6, S38: a billing settled by a credit memo still
// counted as fully owed in arAgingSummary (Billing overview, the Aging
// page and Home "Owed"), while the customer page showed the correct
// lower balance. The summary now merges creditApplications like the
// list/detail loaders already did (Audit D).
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { recordBilling } from "@/lib/services/billings";
import { arAgingSummary } from "@/lib/billing/views";
import { applyCreditSimple } from "@/lib/services/collections";
import { postCustomerReturn } from "@/lib/services/customer-returns";
import { recordDelivery } from "@/lib/services/deliveries";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { getSettingsSnapshot } from "@/lib/settings";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("fix batch 2 money (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 870_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 730_000 + Math.floor(Math.random() * 50_000);
  const nextDr = () => String(++drSeq);

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideDrBooklet() {
    const typeWide = { atpNo: "", atpDate: "", printer: "", seriesFrom: 1, seriesTo: 9_999_999, bookletCount: 10, setsPerBooklet: 50, isNonVat: true };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      const ib = snap.settings.invoiceBooklet;
      if ((ib.deliveryReceipt?.seriesTo ?? 0) >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1,
            data: { ...(latest.data as object), invoiceBooklet: { ...ib, deliveryReceipt: { ...typeWide } } } as never,
            changedKey: "invoiceBooklet",
            before: ib,
            after: { deliveryReceipt: typeWide },
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // version race — retry
      }
    }
  }

  async function ensureWideBooklet() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.invoiceBooklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      const wide = { ...snap.settings.invoiceBooklet, seriesTo: 9_999_999 };
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
        // version race — retry
      }
    }
  }

  it("F14: aging counts a billing net of return credit applied to it", async () => {
    admin = await makeUser("costs");
    await ensureWideBooklet();
    await ensureWideDrBooklet();
    const year = await freshYear();
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          { id: null, description: "Widget A", kind: "GOODS", qty: "2", unit: "pc", supplierId: null, supplierUnitCost: "0", unitPrice: "500" },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-F14-${tag()}`, deliveryAddressId }, admin);
    const soWithItems = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    const itemId = soWithItems.items[0]!.id;
    await recordDelivery(
      so.id,
      { drNumber: nextDr(), deliveryDate: new Date(Date.UTC(year, 2, 6)), idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "2.00" }] },
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

    const agingFor = async () => {
      const summary = await arAgingSummary();
      return summary.byCustomer.find((r) => r.customerId === customer.id)?.aging.total;
    };
    expect(await agingFor()).toBe("1000.00");

    // Return 1 of 2 (credit 500) and apply it to the billing.
    await postCustomerReturn(
      so.id,
      { returnDate: new Date(Date.UTC(year, 2, 10)), reason: null, lines: [{ lineId: itemId, qty: "1" }] },
      admin,
    );
    await applyCreditSimple(customer.id, billing.id, "500.00", admin);

    // The summary must now show 500 owed, not the pre-fix 1000.
    expect(await agingFor()).toBe("500.00");
  });
});
