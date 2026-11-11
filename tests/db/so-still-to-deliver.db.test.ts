// SL-02: Still to deliver list filter. Runs on MySQL 8 (TEST_DATABASE_URL).

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
import { listSalesOrdersView } from "@/lib/quotes/views";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordDelivery } from "@/lib/services/deliveries";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

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

describe.skipIf(!env.hasDb)("SL-02 still to deliver filter (MySQL)", () => {
  let admin: DocActor;
  let drSeq = 970_000 + Math.floor(Math.random() * 20_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-to-deliver-uploads-"));
    admin = await makeUser("costs");
    await ensureWideDrBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeSo(
    year: number,
    buyerPoNo: string,
    items: { description: string; qty: string; unitPrice: string }[],
  ) {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: items.map((i) => ({
          id: null,
          description: i.description,
          kind: "GOODS" as const,
          qty: i.qty,
          unit: "pcs",
          supplierId: null,
          supplierUnitCost: "0",
          unitPrice: i.unitPrice,
        })),
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo, deliveryAddressId }, admin);
    const soWithItems = await db.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    return { so, items: soWithItems.items };
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

  it("partly delivered OPEN shows; fully delivered hides; removed lines ignored; VOID/CLOSED hide", async () => {
    const year = await freshYear();
    // Unique buyer-PO prefix so search stays inside take:500 on a busy shared DB.
    const tag = `SL02-${year}`;

    const partial = await makeSo(year, `${tag}-PARTIAL`, [
      { description: `Partial A ${year}`, qty: "10", unitPrice: "100" },
      { description: `Partial B ${year}`, qty: "5", unitPrice: "50" },
    ]);
    await deliver(partial.so.id, partial.items[0]!.id, "4");

    const full = await makeSo(year, `${tag}-FULL`, [{ description: `Full ${year}`, qty: "3", unitPrice: "200" }]);
    await deliver(full.so.id, full.items[0]!.id, "3");

    const removedOnly = await makeSo(year, `${tag}-REMOVED`, [
      { description: `Keep live ${year}`, qty: "2", unitPrice: "80" },
      { description: `Remove me ${year}`, qty: "9", unitPrice: "10" },
    ]);
    await deliver(removedOnly.so.id, removedOnly.items[0]!.id, "2");
    await db.salesOrderItem.update({
      where: { id: removedOnly.items[1]!.id },
      data: { removedAt: new Date() },
    });

    const voided = await makeSo(year, `${tag}-VOID`, [{ description: `Void me ${year}`, qty: "4", unitPrice: "25" }]);
    await db.salesOrder.update({ where: { id: voided.so.id }, data: { status: "VOID" } });

    const closed = await makeSo(year, `${tag}-CLOSED`, [{ description: `Close me ${year}`, qty: "4", unitPrice: "25" }]);
    await db.salesOrder.update({ where: { id: closed.so.id }, data: { status: "CLOSED" } });

    const ids = new Set((await listSalesOrdersView({ toDeliver: true, q: tag })).map((r) => r.id));

    expect(ids.has(partial.so.id)).toBe(true);
    expect(ids.has(full.so.id)).toBe(false);
    expect(ids.has(removedOnly.so.id)).toBe(false);
    expect(ids.has(voided.so.id)).toBe(false);
    expect(ids.has(closed.so.id)).toBe(false);
  });
});
