// Part B — "Add from sales order" picker on the PO editor: updatePurchaseOrder
// accepts link ids on NEW lines only, re-checked against the PO's own sales
// order under the SO + PO locks. Over-ordering past the remaining qty is
// ALLOWED (Jerwin's settlement: deliberate extras) and recorded in the audit
// row; supplier mismatch, another SO's line, duplicates and link edits are
// refused.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { createPurchaseOrdersFromSalesOrder, createStandalonePurchaseOrder, updatePurchaseOrder } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import type { PoInput } from "@/lib/validation/purchasing";
import { freshYear, makeCustomer, makeSupplier, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("PO picker — add from sales order (MySQL)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function salesOrder(year: number) {
    const customer = await makeCustomer();
    const [a, b] = await Promise.all([makeSupplier(), makeSupplier()]);
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Laptop i5", kind: "GOODS", qty: "10", unit: "pc", supplierId: a.id, supplierUnitCost: "45000", unitPrice: "52000" },
          { id: null, description: "Mouse", kind: "GOODS", qty: "10", unit: "pc", supplierId: a.id, supplierUnitCost: "500", unitPrice: "800" },
          { id: null, description: "Printer", kind: "GOODS", qty: "2", unit: "unit", supplierId: b.id, supplierUnitCost: "12000.50", unitPrice: "15000" },
          { id: null, description: "USB drive", kind: "GOODS", qty: "4", unit: "pc", supplierId: null, supplierUnitCost: "0", unitPrice: "100" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "1 Example St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-PICK", deliveryAddressId: delivAddr.id }, admin, { date: new Date(Date.UTC(year, 2, 2)) });
    const items = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    return { customer, a, b, q, so, items };
  }

  async function salesOrderWithLot(year: number) {
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
          {
            id: null,
            description: "Software Bundle",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "100000",
            isLot: true,
            components: [
              { id: null, itemId: null, description: "Subscription", qty: "1", unit: "lot", supplierId: sup.id, unitCost: "50000" },
            ],
          },
          { id: null, description: "Laptop", kind: "GOODS", qty: "1", unit: "pc", supplierId: sup.id, supplierUnitCost: "45000", unitPrice: "52000" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "1 Example St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-LOT", deliveryAddressId: delivAddr.id }, admin, { date: new Date(Date.UTC(year, 2, 2)) });
    const lot = await db.salesOrderItem.findFirstOrThrow({
      where: { salesOrderId: so.id, isLot: true, removedAt: null },
      include: { components: { where: { removedAt: null } } },
    });
    const plain = await db.salesOrderItem.findFirstOrThrow({
      where: { salesOrderId: so.id, isLot: false, removedAt: null },
    });
    return { customer, sup, q, so, lot, comp: lot.components[0]!, plain };
  }

  /** A draft PO for supplier A holding only the laptop line (qty 4). */
  async function draftPoWithLaptop(year: number, ctx: Awaited<ReturnType<typeof salesOrder>>) {
    const laptop = ctx.items[0]!;
    const [po] = await createPurchaseOrdersFromSalesOrder(
      ctx.so.id,
      {
        date: new Date(Date.UTC(year, 2, 3)),
        expectedDate: null,
        deliveryAddressText: null,
        supplierPicks: {},
        idempotencyKey: `pick-base-${year}`,
        rows: [{ key: laptop.id, supplierId: ctx.a.id, qty: "4" }],
      },
      admin,
    );
    return { po: po!, laptop };
  }

  const poInput = (year: number, po: { supplierId: string; date: Date }, items: PoInput["items"]): PoInput => ({
    supplierId: po.supplierId,
    supplierContactId: null,
    date: po.date,
    expectedDate: null,
    terms: "Net 30",
    deliveryAddressText: null,
    supplierAddressText: null,
    notes: null,
    items,
  });

  const asItems = (po: { items: { id: string; description: string; kind: "GOODS" | "SERVICES"; qty: { toFixed(n: number): string }; unit: string; unitCost: { toFixed(n: number): string }; salesOrderItemId: string | null; salesOrderItemComponentId: string | null }[] }): PoInput["items"] =>
    po.items
      .filter((i) => !("removedAt" in i) || !(i as { removedAt?: Date | null }).removedAt)
      .map((i) => ({
        id: i.id,
        description: i.description,
        kind: i.kind,
        qty: i.qty.toFixed(2),
        unit: i.unit,
        unitCost: i.unitCost.toFixed(2),
        salesOrderItemId: i.salesOrderItemId,
        salesOrderItemComponentId: i.salesOrderItemComponentId,
      }));

  it("adds a same-supplier line with the claim, and a no-supplier line flagged in the audit", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const { po } = await draftPoWithLaptop(year, ctx);
    const mouse = ctx.items[1]!;
    const usb = ctx.items[3]!;
    const fresh = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
    const after = await updatePurchaseOrder(
      po.id,
      poInput(year, fresh, [
        ...asItems(fresh),
        { id: null, description: "Mouse", kind: "GOODS", qty: "10", unit: "pc", unitCost: "500", salesOrderItemId: mouse.id },
        { id: null, description: "USB drive", kind: "GOODS", qty: "4", unit: "pc", unitCost: "0", salesOrderItemId: usb.id },
      ]),
      admin,
    );
    const mouseLine = after.items.find((i) => i.salesOrderItemId === mouse.id);
    expect(mouseLine?.activeSalesOrderItemId).toBe(mouse.id);
    const usbLine = after.items.find((i) => i.salesOrderItemId === usb.id);
    expect(usbLine?.activeSalesOrderItemId).toBe(usb.id);
    const audit = await db.auditLog.findFirst({
      where: { entityType: "PurchaseOrder", entityId: po.id, action: "update" },
      orderBy: { at: "desc" },
    });
    const added = (audit?.after as { addedFromSalesOrder?: { salesOrderItemId: string | null; wasNoSupplier: boolean }[] } | null)?.addedFromSalesOrder ?? [];
    expect(added).toHaveLength(2);
    expect(added.find((x) => x.salesOrderItemId === usb.id)?.wasNoSupplier).toBe(true);
    expect(added.find((x) => x.salesOrderItemId === mouse.id)?.wasNoSupplier).toBe(false);
  });

  it("a second PO for the same supplier links the same line WITHOUT the claim", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const { po, laptop } = await draftPoWithLaptop(year, ctx);
    // Second PO created from the SO holds the claim-free remainder path; make
    // it through Create-POs for the mouse, then picker-add the laptop line.
    const mouse = ctx.items[1]!;
    const [po2] = await createPurchaseOrdersFromSalesOrder(
      ctx.so.id,
      {
        date: new Date(Date.UTC(year, 2, 4)),
        expectedDate: null,
        deliveryAddressText: null,
        supplierPicks: {},
        idempotencyKey: `pick-second-${year}`,
        rows: [{ key: mouse.id, supplierId: ctx.a.id, qty: "10" }],
      },
      admin,
    );
    const fresh2 = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po2!.id }, include: { items: true } });
    const after = await updatePurchaseOrder(
      po2!.id,
      poInput(year, fresh2, [
        ...asItems(fresh2),
        { id: null, description: "Laptop i5", kind: "GOODS", qty: "6", unit: "pc", unitCost: "45000", salesOrderItemId: laptop.id },
      ]),
      admin,
    );
    const line = after.items.find((i) => i.salesOrderItemId === laptop.id);
    // The first PO still holds the unique claim; this line is link-only.
    expect(line?.salesOrderItemId).toBe(laptop.id);
    expect(line?.activeSalesOrderItemId).toBeNull();
    void po;
  });

  it("refuses a different supplier's line, another SO's line, a duplicate, and a link change on an existing line", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const { po, laptop } = await draftPoWithLaptop(year, ctx);
    const printer = ctx.items[2]!;
    const fresh = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
    const base = asItems(fresh);

    await expect(
      updatePurchaseOrder(po.id, poInput(year, fresh, [...base, { id: null, description: "Printer", kind: "GOODS", qty: "1", unit: "unit", unitCost: "12000.50", salesOrderItemId: printer.id }]), admin),
    ).rejects.toThrow(/different supplier/);

    const other = await salesOrder(year);
    await expect(
      updatePurchaseOrder(po.id, poInput(year, fresh, [...base, { id: null, description: "Laptop i5", kind: "GOODS", qty: "1", unit: "pc", unitCost: "45000", salesOrderItemId: other.items[0]!.id }]), admin),
    ).rejects.toThrow(/not a line of this PO's sales order/);

    await expect(
      updatePurchaseOrder(po.id, poInput(year, fresh, [...base, { id: null, description: "Laptop i5", kind: "GOODS", qty: "1", unit: "pc", unitCost: "45000", salesOrderItemId: laptop.id }]), admin),
    ).rejects.toThrow(/already on this purchase order/);

    const relinked = base.map((i) => (i.salesOrderItemId === laptop.id ? { ...i, salesOrderItemId: ctx.items[1]!.id } : i));
    await expect(updatePurchaseOrder(po.id, poInput(year, fresh, relinked), admin)).rejects.toThrow(/link can't be changed/);
  });

  it("allows ordering past the remaining qty and records the over-order in the audit", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const { po } = await draftPoWithLaptop(year, ctx);
    const mouse = ctx.items[1]!;
    const fresh = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
    const after = await updatePurchaseOrder(
      po.id,
      poInput(year, fresh, [
        ...asItems(fresh),
        { id: null, description: "Mouse", kind: "GOODS", qty: "12", unit: "pc", unitCost: "500", salesOrderItemId: mouse.id },
      ]),
      admin,
    );
    expect(after.items.find((i) => i.salesOrderItemId === mouse.id)?.qty.toFixed(2)).toBe("12.00");
    const audit = await db.auditLog.findFirst({
      where: { entityType: "PurchaseOrder", entityId: po.id, action: "update" },
      orderBy: { at: "desc" },
    });
    const added = (audit?.after as { addedFromSalesOrder?: { overOrder: { qty: string; remainingQty: string } | null }[] } | null)?.addedFromSalesOrder ?? [];
    expect(added[0]?.overOrder).toEqual({ qty: "12", remainingQty: "10.00" });
  });

  it("createStandalonePurchaseOrder strips both sales-order and component links", async () => {
    const year = await freshYear();
    const ctx = await salesOrderWithLot(year);
    const po = await createStandalonePurchaseOrder(
      {
        supplierId: ctx.sup.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 5)),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [
          {
            id: null,
            description: "Crafted standalone line",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            unitCost: "50000",
            salesOrderItemId: ctx.lot.id,
            salesOrderItemComponentId: ctx.comp.id,
          },
        ],
      },
      admin,
    );
    expect(po.salesOrderId).toBeNull();
    const item = po.items[0]!;
    expect(item.salesOrderItemId).toBeNull();
    expect(item.salesOrderItemComponentId).toBeNull();
    expect(item.activeSalesOrderItemId).toBeNull();
    expect(item.activeSalesOrderItemComponentId).toBeNull();

    const stored = await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.salesOrderItemId).toBeNull();
    expect(stored.salesOrderItemComponentId).toBeNull();
    expect(stored.activeSalesOrderItemId).toBeNull();
    expect(stored.activeSalesOrderItemComponentId).toBeNull();
  });

  it("refuses isLot parents in update picker path and only allows component ids for lots", async () => {
    const year = await freshYear();
    const ctx = await salesOrderWithLot(year);
    const [po] = await createPurchaseOrdersFromSalesOrder(
      ctx.so.id,
      {
        date: new Date(Date.UTC(year, 2, 3)),
        expectedDate: null,
        deliveryAddressText: null,
        supplierPicks: {},
        idempotencyKey: `pick-lot-${year}`,
        rows: [{ key: ctx.plain.id, supplierId: ctx.sup.id, qty: "1" }],
      },
      admin,
    );
    const fresh = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po!.id }, include: { items: true } });
    const base = asItems(fresh);

    await expect(
      updatePurchaseOrder(
        po!.id,
        poInput(year, fresh, [
          ...base,
          { id: null, description: "Lot Parent", kind: "GOODS", qty: "1", unit: "lot", unitCost: "0", salesOrderItemId: ctx.lot.id },
        ]),
        admin,
      ),
    ).rejects.toThrow(/Order the components of a lot, not the lot itself/);

    const after = await updatePurchaseOrder(
      po!.id,
      poInput(year, fresh, [
        ...base,
        {
          id: null,
          description: "Subscription",
          kind: "GOODS",
          qty: "1",
          unit: "lot",
          unitCost: "50000",
          salesOrderItemComponentId: ctx.comp.id,
        },
      ]),
      admin,
    );
    const compLine = after.items.find((i) => i.salesOrderItemComponentId === ctx.comp.id);
    expect(compLine).toBeDefined();
    expect(compLine?.activeSalesOrderItemComponentId).toBe(ctx.comp.id);
  });
});
