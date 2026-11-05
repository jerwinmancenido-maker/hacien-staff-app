// Audit F: purchasing visible to non-cost users (no money).
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

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
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { createPurchaseOrdersFromSalesOrder } from "@/lib/services/purchase-orders";
import { getPurchaseOrderView, listPurchaseOrdersView } from "@/lib/purchasing/views";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput } from "./fixtures";

describe.skipIf(!env.hasDb)("purchasing visible to non-cost users (MySQL)", () => {
  let admin: DocActor;
  let viewer: DocActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-po-visible-uploads-"));
    admin = await makeUser("costs");
    viewer = await makeUser("viewer");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makePo(year: number) {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Widget A",
            kind: "GOODS",
            qty: "2",
            unit: "pc",
            supplierId: supplier.id,
            supplierUnitCost: "100",
            unitPrice: "500",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "Test St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-1", deliveryAddressId: delivAddr.id }, admin);
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    return { customer, supplier, so, po: po! };
  }

  it("a non-cost viewer can list POs but sees no subtotal", async () => {
    const year = await freshYear();
    const { po } = await makePo(year);
    const rows = await listPurchaseOrdersView({}, viewer);
    const row = rows.find((r) => r.id === po.id);
    expect(row).toBeDefined();
    expect(row!.subtotal).toBeNull();
    expect(row!.number).toBe(po.number);
    const costRows = await listPurchaseOrdersView({}, admin);
    expect(costRows.find((r) => r.id === po.id)!.subtotal).toBe("200.00");
  });

  it("a non-cost viewer can open a PO but sees no money", async () => {
    const year = await freshYear();
    const { po } = await makePo(year);
    const view = await getPurchaseOrderView(po.id, viewer);
    expect(view).not.toBeNull();
    expect(view!.canSeeCosts).toBe(false);
    expect(view!.subtotal).toBeNull();
    expect(view!.bills).toEqual([]);
    expect(view!.match).toBeNull();
    for (const item of view!.items) {
      expect(item.unitCost).toBeNull();
      expect(item.total).toBeNull();
      expect(item.qty).toBe("2.00");
      expect(item.receivedQty).toBe("0.00");
    }
    const costView = await getPurchaseOrderView(po.id, admin);
    expect(costView!.canSeeCosts).toBe(true);
    expect(costView!.subtotal).toBe("200.00");
    expect(costView!.items[0]!.unitCost).toBe("100.00");
  });
});
