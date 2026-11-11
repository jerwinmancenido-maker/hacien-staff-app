// Part A markers pair 1 — db proof: conversion stamps quoteItemId, an edit
// that changes qty/price surfaces in getSalesOrderView as changedVsQuote +
// changedLineCount, and an untouched line shows no marker.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getSalesOrderView } from "@/lib/quotes/views";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { updateSalesOrder } from "@/lib/services/sales-orders";
import { freshYear, makeCustomer, makeSupplier, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("SO Changed-vs-quote markers (MySQL)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("convert stamps quoteItemId; a qty+price edit marks exactly that line", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Laptop i5", kind: "GOODS", qty: "10", unit: "pc", supplierId: supplier.id, supplierUnitCost: "45000", unitPrice: "52000" },
          { id: null, description: "Mouse", kind: "GOODS", qty: "10", unit: "pc", supplierId: supplier.id, supplierUnitCost: "500", unitPrice: "800" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "1 Example St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-MARK", deliveryAddressId: delivAddr.id }, admin, { date: new Date(Date.UTC(year, 2, 2)) });

    const quoteItems = await db.quoteItem.findMany({ where: { quoteId: q.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    const soItems = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    expect(soItems.map((i) => i.quoteItemId)).toEqual(quoteItems.map((i) => i.id));

    // Fresh conversion: nothing changed yet.
    let view = await getSalesOrderView(so.id, admin);
    expect(view?.changedLineCount).toBe(0);
    expect(view?.items.every((i) => !i.changedVsQuote)).toBe(true);

    // Edit line 1 (qty 10 → 12, price 52000 → 51000) with the Admin reason;
    // line 2 untouched.
    const payload = {
      customerId: customer.id,
      contactId: customer.contacts[0]!.id,
      date: so.date,
      terms: "Net 30",
      notes: null,
      buyerPoNo: "B-MARK",
      buyerPoDate: null,
      deliveryAddressId: delivAddr.id,
      priceOverrideReason: "Customer PO changed the order",
      items: soItems.map((i, n) => ({
        id: i.id,
        description: i.description,
        kind: i.kind,
        qty: n === 0 ? "12" : i.qty.toFixed(2),
        unit: i.unit,
        unitPrice: n === 0 ? "51000" : i.unitPrice.toFixed(2),
        supplierId: i.supplierId,
        supplierUnitCost: i.supplierUnitCost.toFixed(2),
        withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
        withholdingAtc: i.withholdingAtc,
        withholdingOverride: i.withholdingOverride,
      })),
    };
    await updateSalesOrder(so.id, payload as never, admin);

    view = await getSalesOrderView(so.id, admin);
    expect(view?.changedLineCount).toBe(1);
    const changed = view?.items.find((i) => i.changedVsQuote);
    expect(changed?.id).toBe(soItems[0]!.id);
    expect(changed?.changedVsQuote).toEqual(["qty 10.00 → 12.00", "price ₱52000.00 → ₱51000.00"]);
    expect(changed?.changedSummary).toBe("Quote: 10.00 pc @ ₱52000.00, now 12.00 pc @ ₱51000.00");
  });
});
