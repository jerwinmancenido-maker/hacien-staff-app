// F29: voidSalesOrder refuses while live downstream documents exist —
// the children are voided first (billings, customer returns,
// deliveries, purchase orders), mirroring voidPurchaseOrder's
// receiving-report guard. Before this guard, an SO whose billing was
// fully Paid could be voided, leaving the Paid billing pointing at a
// void order and the quote reverting to Sent under it (Mac run X6).
// Imports the real services.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { voidSalesOrder } from "@/lib/services/sales-orders";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection } from "@/lib/services/collections";
import { recordDelivery, voidDelivery } from "@/lib/services/deliveries";
import { postCustomerReturn, voidCustomerReturn } from "@/lib/services/customer-returns";
import { voidPurchaseOrder } from "@/lib/services/purchase-orders";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

const REASON = "Entered in error";

describe.skipIf(!env.hasDb)("F29 SO void guard", () => {
  let admin: DocActor;
  let invoiceSeq = 870_000 + Math.floor(Math.random() * 20_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 700_000 + Math.floor(Math.random() * 20_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    admin = await makeUser("costs");
    await ensureWideBooklet();
    await ensureWideDrBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Void guard test booklet" };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.invoiceBooklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1 + attempt,
            data: { ...(latest.data as object), invoiceBooklet: wide } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: wide,
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // version race with another suite — retry
      }
    }
  }

  async function ensureWideDrBooklet() {
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
            version: latest.version + 1 + attempt,
            data: { ...(latest.data as object), invoiceBooklet: { ...ib, deliveryReceipt: { ...typeWide } } } as never,
            changedKey: "invoiceBooklet",
            before: ib,
            after: { deliveryReceipt: typeWide },
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // version race with another suite — retry
      }
    }
  }

  async function openSo(year: number) {
    const customer = await makeCustomer();
    const quote = await createQuote(quoteInput(customer.id, year), admin);
    await approveQuote(quote.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(
      quote.id,
      { buyerPoNo: `B-${tag()}`, deliveryAddressId },
      admin,
      { date: new Date(Date.UTC(year, 2, 2)) },
    );
    const withItems = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    return { customer, quote, so, itemId: withItems.items[0]!.id };
  }

  async function bill(soId: string, year: number, amount: string) {
    return recordBilling(
      {
        salesOrderId: soId,
        amount,
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
  }

  it("a live billing blocks the void; voiding the billing frees it", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const billing = await bill(so.id, year, "10000.00");
    await expect(voidSalesOrder(so.id, REASON, admin)).rejects.toThrow(/Void the billings first/);
    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("OPEN");
    await voidBilling(billing.id, REASON, admin);
    const voided = await voidSalesOrder(so.id, REASON, admin);
    expect(voided.status).toBe("VOID");
  });

  it("a fully Paid billing blocks the void (the X6 case)", async () => {
    const year = await freshYear();
    const { customer, quote, so } = await openSo(year);
    const billing = await bill(so.id, year, "3000.00");
    await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-VG-${tag()}`,
        amountReceived: "3000.00",
        notes: null,
        allocations: [
          { billingId: billing.id, cashApplied: "3000.00", withholdingApplied: "0.00", withholdingRate: null, atcCode: null },
        ],
      },
      admin,
    );
    expect((await db.billing.findUniqueOrThrow({ where: { id: billing.id } })).status).toBe("PAID");
    await expect(voidSalesOrder(so.id, REASON, admin)).rejects.toThrow(/Void the billings first/);
    // Nothing moved: SO still open, quote still Won, billing still Paid.
    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("OPEN");
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("WON");
    expect((await db.billing.findUniqueOrThrow({ where: { id: billing.id } })).status).toBe("PAID");
  });

  it("a live delivery blocks the void; voiding the delivery frees it", async () => {
    const year = await freshYear();
    const { so, itemId } = await openSo(year);
    const delivery = await recordDelivery(
      so.id,
      { drNumber: nextDr(), deliveryDate: new Date(Date.UTC(year, 2, 3)), idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "1.00" }] },
      admin,
    );
    await expect(voidSalesOrder(so.id, REASON, admin)).rejects.toThrow(/Void the deliveries first/);
    await voidDelivery(delivery.id, REASON, admin);
    const voided = await voidSalesOrder(so.id, REASON, admin);
    expect(voided.status).toBe("VOID");
  });

  it("a posted customer return blocks before its delivery does", async () => {
    const year = await freshYear();
    const { so, itemId } = await openSo(year);
    const delivery = await recordDelivery(
      so.id,
      { drNumber: nextDr(), deliveryDate: new Date(Date.UTC(year, 2, 3)), idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "2.00" }] },
      admin,
    );
    const ret = await postCustomerReturn(
      so.id,
      { returnDate: new Date(Date.UTC(year, 2, 10)), reason: "Defective", lines: [{ lineId: itemId, qty: "1" }] },
      admin,
    );
    await expect(voidSalesOrder(so.id, REASON, admin)).rejects.toThrow(/Void the customer returns first/);
    await voidCustomerReturn(ret.id, REASON, admin);
    await expect(voidSalesOrder(so.id, REASON, admin)).rejects.toThrow(/Void the deliveries first/);
    await voidDelivery(delivery.id, REASON, admin);
    const voided = await voidSalesOrder(so.id, REASON, admin);
    expect(voided.status).toBe("VOID");
  });

  it("a live purchase order blocks the void; voiding the PO frees it", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const supplier = await makeSupplier();
    const soRow = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
    const po = await db.purchaseOrder.create({
      data: {
        number: `PO-${tag()}`,
        supplierId: supplier.id,
        salesOrderId: so.id,
        date: new Date(Date.UTC(year, 2, 3)),
        settingsVersionId: soRow.settingsVersionId,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    await expect(voidSalesOrder(so.id, REASON, admin)).rejects.toThrow(/Void the purchase orders first/);
    await voidPurchaseOrder(po.id, REASON, admin);
    const voided = await voidSalesOrder(so.id, REASON, admin);
    expect(voided.status).toBe("VOID");
  });
});
