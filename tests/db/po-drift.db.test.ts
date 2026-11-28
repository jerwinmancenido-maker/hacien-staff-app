// Same-rate drift warning (ERP adoption item 6) — the server loader behind
// the PO save gate: linked lines compare against the SO line's cost (or the
// lot component's), existing lines resolve their link from the STORED row
// (the payload's link ids are ignored for them, exactly like the save),
// new lines use the payload's link ids, and unlinked lines never drift.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { findPoCostDrift } from "@/lib/purchasing/drift";
import { createPurchaseOrdersFromSalesOrder } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { freshYear, makeCustomer, makeSupplier, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("PO cost drift — server loader (MySQL)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function salesOrderWithPo(year: number) {
    const customer = await makeCustomer();
    const sup = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Laptop i5", kind: "GOODS", qty: "10", unit: "pc", supplierId: sup.id, supplierUnitCost: "45000", unitPrice: "52000" },
          { id: null, description: "Mouse", kind: "GOODS", qty: "10", unit: "pc", supplierId: sup.id, supplierUnitCost: "500", unitPrice: "800" },
          {
            id: null, description: "Software Bundle", kind: "GOODS", qty: "1", unit: "lot",
            supplierId: null, supplierUnitCost: "0", unitPrice: "100000", isLot: true,
            components: [
              { id: null, itemId: null, description: "Subscription", qty: "1", unit: "lot", supplierId: sup.id, unitCost: "50000" },
            ],
          },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "1 Example St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-DRIFT", deliveryAddressId: delivAddr.id }, admin, { date: new Date(Date.UTC(year, 2, 2)) });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    const poItems = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po!.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    return { so, po: po!, poItems };
  }

  const line = (over: Record<string, unknown>) => ({
    description: "Line",
    kind: "GOODS" as const,
    qty: "1",
    unit: "pc",
    unitCost: "0",
    ...over,
  });

  it("unchanged costs produce no drift — links resolved from the stored rows", async () => {
    const year = await freshYear();
    const { po, poItems } = await salesOrderWithPo(year);
    // Payload carries NO link ids for the existing lines (the editor's links
    // for saved lines are informational; the stored row is authoritative).
    const items = poItems.map((i) => line({ id: i.id, description: i.description, unitCost: i.unitCost.toFixed(2), salesOrderItemId: null, salesOrderItemComponentId: null }));
    expect(await findPoCostDrift(db, po.id, items)).toEqual([]);
  });

  it("an edited cost up and another down both drift, with % vs the SO cost", async () => {
    const year = await freshYear();
    const { po, poItems } = await salesOrderWithPo(year);
    const laptop = poItems.find((i) => i.description === "Laptop i5")!;
    const mouse = poItems.find((i) => i.description === "Mouse")!;
    const entries = await findPoCostDrift(db, po.id, [
      line({ id: laptop.id, description: laptop.description, unitCost: "54000" }),
      line({ id: mouse.id, description: mouse.description, unitCost: "450" }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ description: "Laptop i5", direction: "higher", pct: "20.0", poUnitCost: "54000", soUnitCost: "45000.00" });
    expect(entries[1]).toMatchObject({ description: "Mouse", direction: "lower", pct: "10.0", poUnitCost: "450", soUnitCost: "500.00" });
  });

  it("a lot-component line compares against the component's cost", async () => {
    const year = await freshYear();
    const { po, poItems } = await salesOrderWithPo(year);
    const comp = poItems.find((i) => i.salesOrderItemComponentId)!;
    const entries = await findPoCostDrift(db, po.id, [
      line({ id: comp.id, description: comp.description, unitCost: "40000" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "lower", pct: "20.0", soUnitCost: "50000.00" });
  });

  it("a NEW line uses the payload's link ids (the editor picker path)", async () => {
    const year = await freshYear();
    const { so } = await salesOrderWithPo(year);
    const soLine = await db.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: so.id, description: "Laptop i5", removedAt: null } });
    const entries = await findPoCostDrift(db, null, [
      line({ description: "Laptop i5", unitCost: "46000", salesOrderItemId: soLine.id, salesOrderItemComponentId: null }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "higher", soUnitCost: "45000.00" });
  });

  it("unlinked lines never drift (standalone rule)", async () => {
    const entries = await findPoCostDrift(db, null, [
      line({ description: "Freight", unitCost: "9999", salesOrderItemId: null, salesOrderItemComponentId: null }),
      line({ description: "No ids at all", unitCost: "1" }),
    ]);
    expect(entries).toEqual([]);
  });
});
