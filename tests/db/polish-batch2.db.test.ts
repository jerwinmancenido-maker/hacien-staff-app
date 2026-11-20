// Fix batch 2 PR-8 (2026-11-19):
// - F17: a lot-component PO line warned "PO qty is more than the SO
//   qty" because it compared the component total (4 per bundle × 1
//   bundle) against the lot line's qty (1). The PO view now compares
//   component lines against component qty × lot qty, summing only
//   siblings of the same component.
// - F22: the packing list's Delivery address came from the customer's
//   legacy free-text address, not the SO's chosen delivery address —
//   blank whenever the legacy field was empty.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getAttachmentSheetModel } from "@/lib/print/attachment";
import { createPurchaseOrdersFromSalesOrder } from "@/lib/services/purchase-orders";
import { getPurchaseOrderView } from "@/lib/purchasing/views";
import { recordDelivery } from "@/lib/services/deliveries";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { getSettingsSnapshot } from "@/lib/settings";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("fix batch 2 polish (MySQL)", () => {
  let admin: DocActor;
  let drSeq = 740_000 + Math.floor(Math.random() * 50_000);
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

  it("F17: a lot-component PO line at the exact expected qty shows no qty warning", async () => {
    admin = await makeUser("costs");
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Bundle",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "10000",
            isLot: true,
            components: [
              { id: null, itemId: null, description: "Widget part", qty: "4", unit: "pc", supplierId: supplier.id, unitCost: "1000" },
            ],
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-F17-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const pos = await createPurchaseOrdersFromSalesOrder(
      so.id,
      {
        date: new Date(Date.UTC(year, 2, 3)),
        expectedDate: null,
        deliveryAddressText: null,
        supplierPicks: {},
        idempotencyKey: `f17-${tag()}`,
      } as never,
      admin,
    );
    expect(pos).toHaveLength(1);
    const view = await getPurchaseOrderView(pos[0]!.id, admin);
    expect(view).not.toBeNull();
    const line = view!.items[0]!;
    expect(line.qty).toBe("4.00");
    expect(line.qtyWarning).toBeNull();
  });

  it("F22: the packing list address is the SO's delivery address", async () => {
    admin = await makeUser("costs");
    await ensureWideDrBooklet();
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "500" },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-F22-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const soRow = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    expect(soRow.deliveryAddress).toBeTruthy();
    const delivery = await recordDelivery(
      so.id,
      {
        drNumber: nextDr(),
        deliveryDate: new Date(Date.UTC(year, 2, 3)),
        idSightChecked: false,
        items: [{ salesOrderItemId: soRow.items[0]!.id, qty: "1.00" }],
      },
      admin,
    );
    const sheet = await getAttachmentSheetModel(delivery.id);
    expect(sheet).not.toBeNull();
    expect(sheet!.customerAddress).toBe(soRow.deliveryAddress);
  });
});
