// Audit C: billing before any delivery warns (never blocks) and is noted
// in the audit trail. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

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
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet billing warn" };
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

describe.skipIf(!env.hasDb)("billing before delivery warning (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 850_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 960_000 + Math.floor(Math.random() * 30_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-billing-warn-uploads-"));
    admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
    await ensureWideDrBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeOpenSo(year: number) {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Widget A",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "1000",
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

  async function soAuditAfter(soId: string, billingNumber: string) {
    const rows = await db.auditLog.findMany({
      where: { entityType: "SalesOrder", entityId: soId, action: "update" },
      orderBy: { at: "desc" },
    });
    return rows.find((r) => (r.after as { billingRecorded?: string } | null)?.billingRecorded === billingNumber);
  }

  it("billing with no delivery records the warning flag in the audit trail — and still records", async () => {
    const year = await freshYear();
    const { so } = await makeOpenSo(year);
    const billing = await bill(so.id, year, "1000.00");
    expect(billing.number).toMatch(/^BL-\d{4}-\d+$/);
    const audit = await soAuditAfter(so.id, billing.number);
    expect((audit?.after as { billedBeforeDelivery?: boolean } | null)?.billedBeforeDelivery).toBe(true);
  });

  it("billing after a delivery carries no warning flag", async () => {
    const year = await freshYear();
    const { so, itemId } = await makeOpenSo(year);
    await recordDelivery(
      so.id,
      {
        drNumber: nextDr(),
        deliveryDate: new Date(),
        idSightChecked: false,
        items: [{ salesOrderItemId: itemId, qty: "1.00" }],
      },
      admin,
    );
    const billing = await bill(so.id, year, "1000.00");
    const audit = await soAuditAfter(so.id, billing.number);
    expect((audit?.after as { billedBeforeDelivery?: boolean } | null)?.billedBeforeDelivery).toBeUndefined();
  });
});
