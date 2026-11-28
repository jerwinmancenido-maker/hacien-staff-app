// ERP adoption item 14 — the billing print model carries the payment
// schedule for COD / 50-50 / Net 30 terms and nothing for any other
// terms, against MySQL 8 (TEST_DATABASE_URL).
//
// The wiring under test is getBillingPrintModel: it must feed the
// schedule builder the SALES ORDER's stored terms text, the billing's
// gross amount and the billing's invoice date — and the schedule must
// never carry withholding (office math, never on a customer print).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import { getBillingPrintModel } from "@/lib/print/views";
import { formatDate } from "@/lib/format";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("billing print payment schedule (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 710_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Parallel suites can republish settings with the default 1–500 booklet. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet billing" };
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

  async function billingWithTerms(terms: string, amount: string, month: number, day: number) {
    await ensureWideBooklet();
    const year = await freshYear();
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
        terms,
        notes: null,
        items: [
          {
            id: null,
            description: "Goods",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "80000",
            unitPrice: amount,
          },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-PS", deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const invoiceDate = new Date(Date.UTC(year, month, day));
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount,
        invoiceNo: nextInvoice(),
        invoiceDate,
        dueDate: invoiceDate,
        notes: null,
      },
      admin,
    );
    return { billing, year };
  }

  it("COD terms: the print model carries one row for the full gross Total", async () => {
    const { billing } = await billingWithTerms("COD", "10000.01", 10, 20);
    const print = await getBillingPrintModel(billing.id);
    expect(print).not.toBeNull();
    expect(print!.doc.paymentSchedule).toEqual([
      { label: "100% — Cash on Delivery", due: "On delivery", amount: "10000.01" },
    ]);
    // Gross only: the schedule JSON must never mention withholding.
    expect(JSON.stringify(print!.doc.paymentSchedule)).not.toMatch(/withhold|EWT/i);
  });

  it("50/50 terms: two rows that sum exactly to the Total, odd centavo included", async () => {
    const { billing } = await billingWithTerms("50% down, 50% on delivery", "10000.01", 10, 12);
    const print = await getBillingPrintModel(billing.id);
    expect(print!.doc.paymentSchedule).toEqual([
      { label: "50% — down payment", due: "On order confirmation", amount: "5000.01" },
      { label: "50% — balance", due: "On delivery", amount: "5000.00" },
    ]);
  });

  it("Net 30 terms: one row due 30 days after the invoice date", async () => {
    const { billing, year } = await billingWithTerms("Net 30 (approved accounts only)", "750000.00", 10, 9);
    const print = await getBillingPrintModel(billing.id);
    expect(print!.doc.paymentSchedule).toEqual([
      { label: "100%", due: formatDate(new Date(Date.UTC(year, 11, 9))), amount: "750000.00" },
    ]);
  });

  it("100% upfront terms: no schedule on the print model", async () => {
    const { billing } = await billingWithTerms("100% upfront (software and special orders)", "10000.00", 10, 20);
    const print = await getBillingPrintModel(billing.id);
    expect(print!.doc.paymentSchedule).toBeNull();
  });

  it("custom terms: no schedule on the print model", async () => {
    const { billing } = await billingWithTerms("Pay in 7 days, please", "10000.00", 10, 20);
    const print = await getBillingPrintModel(billing.id);
    expect(print!.doc.paymentSchedule).toBeNull();
  });
});
