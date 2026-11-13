// Phase 2 #6 (db): customerExposure against MySQL — scenarios C1–C5.
// C1 AR ₱30k + unbilled open SO ₱80k = ₱110k, over a ₱100k limit.
// C2 everything collected and billed → no warning.
// C3 no limit set → never warns.
// C4 an over-limit SO save SUCCEEDS (warning only, never a block).
// C5 voided billing / void SO contribute ₱0.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { creditLimitWarningText, customerExposure } from "@/lib/billing/customer-exposure";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection } from "@/lib/services/collections";
import { updateSalesOrder, voidSalesOrder } from "@/lib/services/sales-orders";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("customerExposure (db)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Parallel suites can republish settings with the default 1–500 booklet. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet exposure" };
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
        // Unique version race with another suite — retry.
      }
    }
  }

  let invoiceSeq = 810_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  async function openSo(customerId: string, contactId: string, year: number, unitPrice: string) {
    await ensureWideBooklet();
    const q = await createQuote(
      {
        customerId,
        contactId,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          {
            id: null,
            description: "Goods",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice,
          },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customerId);
    return convertQuoteToSalesOrder(q.id, { buyerPoNo: "EXP", deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
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

  it("C1 + C4 + C2 + C5: exposure sums AR + unbilled, warns over the limit, never blocks, voids drop out", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    await db.customer.update({ where: { id: customer.id }, data: { creditLimit: "100000.00" } });
    const contactId = customer.contacts[0]!.id;

    // SO-A: ₱30,000 contract, fully billed, unpaid → AR ₱30,000.
    const soA = await openSo(customer.id, contactId, year, "30000.00");
    const billingA = await bill(soA.id, year, "30000.00");
    // SO-B: ₱80,000 contract, nothing billed → unbilled ₱80,000.
    const soB = await openSo(customer.id, contactId, year, "80000.00");

    const e1 = await customerExposure(db, customer.id);
    expect(e1.arOutstanding).toBe("30000.00");
    expect(e1.unbilledOpenOrders).toBe("80000.00");
    expect(e1.totalExposure).toBe("110000.00");
    expect(e1.creditLimit).toBe("100000.00");
    expect(e1.overLimit).toBe(true);
    expect(creditLimitWarningText(e1)).toContain("₱110,000.00");

    // C4: saving SO-B while over the limit SUCCEEDS (same items, notes edit).
    const saved = await updateSalesOrder(
      soB.id,
      {
        buyerPoNo: "EXP",
        contactId,
        terms: "Net 30",
        notes: "over-limit save",
        deliveryAddress: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: null, supplierUnitCost: "0", unitPrice: "80000.00" },
        ],
      },
      admin,
    );
    expect(saved.id).toBe(soB.id);

    // C2: collect SO-A's billing in full → AR drops to ₱0; exposure is now
    // just the ₱80,000 unbilled SO, under the limit → no warning.
    await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-EXP-${year}`,
        amountReceived: "30000.00",
        notes: null,
        allocations: [
          { billingId: billingA.id, cashApplied: "30000.00", withholdingApplied: "0.00", withholdingRate: null, atcCode: null },
        ],
      },
      admin,
    );
    const e2 = await customerExposure(db, customer.id);
    expect(e2.arOutstanding).toBe("0.00");
    expect(e2.totalExposure).toBe("80000.00");
    expect(e2.overLimit).toBe(false);
    expect(creditLimitWarningText(e2)).toBeNull();

    // C5: a voided billing contributes ₱0 — bill SO-B ₱80,000 then void it;
    // exposure must return to ₱80,000 unbilled (not ₱80k AR + ₱0 unbilled
    // double-counted, and not ₱160k).
    const billingB = await bill(soB.id, year, "80000.00");
    const mid = await customerExposure(db, customer.id);
    expect(mid.arOutstanding).toBe("80000.00");
    expect(mid.unbilledOpenOrders).toBe("0.00");
    await voidBilling(billingB.id, "exposure test void", admin);
    const e3 = await customerExposure(db, customer.id);
    expect(e3.arOutstanding).toBe("0.00");
    expect(e3.unbilledOpenOrders).toBe("80000.00");

    // C5 (SO side): voiding SO-B removes its unbilled value entirely.
    await voidSalesOrder(soB.id, "exposure test void SO", admin);
    const e4 = await customerExposure(db, customer.id);
    expect(e4.totalExposure).toBe("0.00");
    expect(e4.overLimit).toBe(false);
  });

  it("C3: a customer with no credit limit never warns, even with large exposure", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const so = await openSo(customer.id, customer.contacts[0]!.id, year, "500000.00");
    await bill(so.id, year, "500000.00");
    const e = await customerExposure(db, customer.id);
    expect(e.creditLimit).toBeNull();
    expect(e.totalExposure).toBe("500000.00");
    expect(e.overLimit).toBe(false);
    expect(creditLimitWarningText(e)).toBeNull();
  });
});
