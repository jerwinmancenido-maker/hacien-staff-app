import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { customerDeliveryAddressId, makeCustomer, makeUser, quoteInput } from "./fixtures";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordDelivery, voidDelivery } from "@/lib/services/deliveries";
import { expectedPaymentDateFromIar, isOverdue } from "@/lib/billing/dates";
import { overdueInfo } from "@/lib/billing/views";

async function makeTestSalesOrder(admin: DocActor, qty = "10") {
  const customer = await makeCustomer();
  const q = await createQuote(
    quoteInput(customer.id, 2026, {
      items: [
        {
          id: null,
          description: "Widget A",
          kind: "GOODS",
          qty,
          unit: "pcs",
          supplierId: null,
          supplierUnitCost: "0",
          unitPrice: "100",
        },
      ],
    }),
    admin,
  );
  await approveQuote(q.id, admin);
  const deliveryAddressId = await customerDeliveryAddressId(customer.id);
  return convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddressId }, admin);
}

describe.skipIf(!env.hasDb)("sales order deliveries and government deals (MySQL)", () => {
  it("delivered qty can't exceed ordered", async () => {
    const admin = await makeUser("costs");
    const so = await makeTestSalesOrder(admin, "10");
    const soWithItems = await db.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { items: true },
    });
    const itemId = soWithItems.items[0]!.id;

    // Delivering 11 when only 10 ordered should fail
    await expect(
      recordDelivery(
        so.id,
        {
          drNumber: "DR-001",
          deliveryDate: new Date(),
          idSightChecked: false,
          items: [{ salesOrderItemId: itemId, qty: "11.00" }],
        },
        admin,
      ),
    ).rejects.toThrow("Delivered quantity cannot exceed ordered");

    // Delivering 6 is valid
    const del1 = await recordDelivery(
      so.id,
      {
        drNumber: "DR-001",
        deliveryDate: new Date(),
        idSightChecked: false,
        items: [{ salesOrderItemId: itemId, qty: "6.00" }],
      },
      admin,
    );
    expect(del1).toBeDefined();

    // Voiding reverses quantities
    const voided = await voidDelivery(del1.id, "Entered wrong quantity", admin);
    expect(voided.voidedAt).toBeInstanceOf(Date);

    // Delivering 10 after void succeeds
    const del2 = await recordDelivery(
      so.id,
      {
        drNumber: "DR-002",
        deliveryDate: new Date(),
        idSightChecked: false,
        items: [{ salesOrderItemId: itemId, qty: "10.00" }],
      },
      admin,
    );
    expect(del2).toBeDefined();
  });

  it("DR number is required", async () => {
    const admin = await makeUser("costs");
    const so = await makeTestSalesOrder(admin, "5");
    const soWithItems = await db.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { items: true },
    });

    await expect(
      recordDelivery(
        so.id,
        {
          drNumber: "",
          deliveryDate: new Date(),
          idSightChecked: false,
          items: [{ salesOrderItemId: soWithItems.items[0]!.id, qty: "2.00" }],
        },
        admin,
      ),
    ).rejects.toThrow("DR number is required");
  });

  it("sight-check save stores boolean+who+when only", async () => {
    const admin = await makeUser("costs");
    const so = await makeTestSalesOrder(admin, "5");
    const soWithItems = await db.salesOrder.findUniqueOrThrow({
      where: { id: so.id },
      include: { items: true },
    });

    const delivery = await recordDelivery(
      so.id,
      {
        drNumber: "DR-SC-100",
        deliveryDate: new Date("2026-11-05T00:00:00.000Z"),
        receivedBy: "Customer Staff",
        receivedDate: new Date("2026-11-05T00:00:00.000Z"),
        idSightChecked: true,
        items: [{ salesOrderItemId: soWithItems.items[0]!.id, qty: "3.00" }],
      },
      admin,
    );

    const saved = await db.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });

    expect(saved.idSightChecked).toBe(true);
    expect(saved.idCheckedById).toBe(admin.id);
    expect(saved.idCheckedAt).toBeInstanceOf(Date);

    // Verify raw keys in the saved record do not contain any ID type or photo
    const keys = Object.keys(saved);
    expect(keys.some((k) => /idType|idNumber|idPhoto|idCard|idCopy/i.test(k))).toBe(false);
  });

  it("Expected-by math (incl. month rollover)", () => {
    const iar = new Date("2026-11-05T00:00:00.000Z");
    const exp = expectedPaymentDateFromIar(iar);
    expect(exp.toISOString().slice(0, 10)).toBe("2026-12-05");

    const jan31 = new Date("2026-01-31T00:00:00.000Z");
    const expJan = expectedPaymentDateFromIar(jan31);
    expect(expJan.toISOString().slice(0, 10)).toBe("2026-03-02");
  });

  it("government billing past Expected by never flagged overdue", () => {
    const dueDate = new Date("2026-12-05T00:00:00.000Z");
    const asOfDec10 = new Date("2026-12-10T00:00:00.000Z");
    const balance = "50000.00";

    expect(isOverdue(dueDate, balance, asOfDec10, 0, true)).toBe(false);
    expect(overdueInfo(dueDate, balance, 0, asOfDec10, true).overdue).toBe(false);
    expect(overdueInfo(dueDate, balance, 0, asOfDec10, true).label).toBeNull();
  });
});
