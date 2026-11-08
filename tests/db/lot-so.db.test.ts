// Lot (bundle) lines, Phase B2 — DB: converting a lot quote copies the
// components to the SO; an SO edit preserves them; Create POs buys the
// components grouped by their own suppliers, tracks them per component,
// and frees a component when its PO is voided.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { updateSalesOrder } from "@/lib/services/sales-orders";
import { createPurchaseOrdersFromSalesOrder, voidPurchaseOrder } from "@/lib/services/purchase-orders";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput } from "./fixtures";

describe("lot sales orders and component POs (db)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function lotSalesOrder(year: number) {
    const customer = await makeCustomer();
    const supA = await makeSupplier();
    const supB = await makeSupplier();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Google Cloud Platform Services",
            kind: "SERVICES" as const,
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "600000",
            isLot: true,
            components: [
              { id: null, itemId: null, description: "GCP subscription", qty: "1", unit: "lot", supplierId: supA.id, unitCost: "300000" },
              { id: null, itemId: null, description: "Support hours", qty: "2", unit: "hour", supplierId: supB.id, unitCost: "50000" },
            ],
          },
          {
            id: null,
            description: "Laptop i5",
            kind: "GOODS" as const,
            qty: "1",
            unit: "pc",
            supplierId: supA.id,
            supplierUnitCost: "45000",
            unitPrice: "52000",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "1 Test St, Taguig", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(
      q.id,
      { buyerPoNo: "B-LOT-1", deliveryAddressId: delivAddr.id },
      admin,
      { date: new Date(Date.UTC(year, 2, 2)) },
    );
    return { customer, supA, supB, q, so };
  }

  const fromSo = (year: number, extra: Record<string, unknown> = {}) => ({
    date: new Date(Date.UTC(year, 2, 3)),
    expectedDate: null,
    deliveryAddressText: null,
    supplierPicks: {},
    ...extra,
  });

  it("conversion copies the lot flag and components to the SO", async () => {
    const year = await freshYear();
    const { so } = await lotSalesOrder(year);
    const items = await db.salesOrderItem.findMany({
      where: { salesOrderId: so.id, removedAt: null },
      orderBy: { sortOrder: "asc" },
      include: { components: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    expect(items).toHaveLength(2);
    const lot = items[0]!;
    expect(lot.isLot).toBe(true);
    expect(lot.components).toHaveLength(2);
    expect(lot.components[0]!.description).toBe("GCP subscription");
    expect(lot.supplierTotal.toFixed(2)).toBe("400000.00");
    expect(lot.margin.toFixed(2)).toBe("200000.00");
    expect(items[1]!.isLot).toBe(false);
    expect(items[1]!.components).toHaveLength(0);
  });

  it("editing the SO keeps the lot's components and totals", async () => {
    const year = await freshYear();
    const { so, customer } = await lotSalesOrder(year);
    const items = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    await updateSalesOrder(
      so.id,
      {
        contactId: customer.contacts[0]!.id,
        buyerPoNo: "B-LOT-1",
        buyerPoDate: null,
        deliveryAddress: so.deliveryAddress,
        terms: so.terms,
        notes: "edited note",
        items: items.map((i) => ({
          id: i.id,
          description: i.description,
          kind: i.kind,
          qty: i.qty.toFixed(2),
          unit: i.unit,
          supplierId: i.supplierId,
          supplierUnitCost: i.supplierUnitCost.toFixed(2),
          unitPrice: i.unitPrice.toFixed(2),
        })),
      } as never,
      admin,
    );
    const lot = await db.salesOrderItem.findFirstOrThrow({
      where: { salesOrderId: so.id, isLot: true, removedAt: null },
      include: { components: { where: { removedAt: null } } },
    });
    expect(lot.components).toHaveLength(2);
    expect(lot.supplierTotal.toFixed(2)).toBe("400000.00");
    const after = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect(after.supplierCost.toFixed(2)).toBe("445000.00");
    expect(after.notes).toBe("edited note");
  });

  it("Create POs buys components grouped by their suppliers, once per component", async () => {
    const year = await freshYear();
    const { so, supA, supB } = await lotSalesOrder(year);
    const pos = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year) as never, admin);
    expect(pos).toHaveLength(2);
    const poA = pos.find((p) => p.supplierId === supA.id)!;
    const poB = pos.find((p) => p.supplierId === supB.id)!;
    // sup A: the GCP component + the normal laptop line.
    expect(poA.items).toHaveLength(2);
    const compLine = poA.items.find((i) => i.salesOrderItemComponentId)!;
    expect(compLine.description).toBe("GCP subscription");
    expect(compLine.unitCost.toFixed(2)).toBe("300000.00");
    expect(compLine.activeSalesOrderItemComponentId).toBe(compLine.salesOrderItemComponentId);
    expect(compLine.activeSalesOrderItemId).toBeNull();
    const laptopLine = poA.items.find((i) => !i.salesOrderItemComponentId)!;
    expect(laptopLine.description).toBe("Laptop i5");
    expect(laptopLine.activeSalesOrderItemId).toBe(laptopLine.salesOrderItemId);
    // sup B: just the support-hours component (2 × ₱50,000).
    expect(poB.items).toHaveLength(1);
    expect(poB.items[0]!.total.toFixed(2)).toBe("100000.00");
    expect(poB.subtotal.toFixed(2)).toBe("100000.00");

    // Second run: everything is already on a PO.
    await expect(createPurchaseOrdersFromSalesOrder(so.id, fromSo(year) as never, admin)).rejects.toThrow(/already on a PO/);

    // Voiding sup B's PO frees its component for a new PO.
    await voidPurchaseOrder(poB.id, "test void", admin);
    const redo = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year) as never, admin);
    expect(redo).toHaveLength(1);
    expect(redo[0]!.supplierId).toBe(supB.id);
    expect(redo[0]!.items).toHaveLength(1);
    expect(redo[0]!.items[0]!.description).toBe("Support hours");
  });
});
