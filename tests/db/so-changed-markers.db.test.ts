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
    expect(changed?.changedVsQuote).toEqual(["qty 10.00 → 12.00", "price ₱52,000.00 → ₱51,000.00"]);
    expect(changed?.changedSummary).toBe("Quote: 10.00 pc @ ₱52,000.00, now 12.00 pc @ ₱51,000.00");
  });

  it("pre-stamp SO (quoteItemId NULL, the SO-2026-0006 case): the view falls back to sortOrder matching", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 3, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Install (pre-stamp)", kind: "SERVICES", qty: "1", unit: "lot", supplierId: supplier.id, supplierUnitCost: "4000", unitPrice: "4999.25" },
          { id: null, description: "Cable (pre-stamp)", kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "250" },
        ],
      } as never,
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr2 = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "2 Example St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-MARK-2", deliveryAddressId: delivAddr2.id }, admin, { date: new Date(Date.UTC(year, 3, 2)) });
    // Simulate a conversion from before the stamp existed.
    await db.salesOrderItem.updateMany({ where: { salesOrderId: so.id }, data: { quoteItemId: null } });
    // The real change (mirrors SO-2026-0006): price 4999.25 -> 5000.00 on line 1.
    await db.salesOrderItem.updateMany({ where: { salesOrderId: so.id, sortOrder: 1 }, data: { unitPrice: "5000.00", total: "5000.00" } });

    const view = await getSalesOrderView(so.id, admin);
    expect(view?.changedLineCount).toBe(1);
    const changed = view?.items.find((i) => i.changedVsQuote);
    expect(changed?.changedVsQuote).toEqual(["price ₱4,999.25 → ₱5,000.00"]);
  });

  it("pre-stamp SO after ↑/↓ reorder: fallback fails closed (no wrong markers)", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 4, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Alpha line", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "100" },
          { id: null, description: "Beta line", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "200", unitPrice: "200" },
        ],
      } as never,
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr3 = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "3 Example St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-MARK-3", deliveryAddressId: delivAddr3.id }, admin, {
      date: new Date(Date.UTC(year, 4, 2)),
    });
    await db.salesOrderItem.updateMany({ where: { salesOrderId: so.id }, data: { quoteItemId: null } });

    const soRows = await db.salesOrderItem.findMany({
      where: { salesOrderId: so.id, removedAt: null },
      orderBy: { sortOrder: "asc" },
    });
    expect(soRows).toHaveLength(2);
    // Swap order like DocumentEditor ↑/↓ then save — planItems renumbers to 1..n.
    // Naive sortOrder matching would compare Beta↔quote Alpha and stamp wrong Changed.
    const reversed = [...soRows].reverse();
    await updateSalesOrder(
      so.id,
      {
        contactId: so.contactId,
        buyerPoNo: "B-MARK-3",
        buyerPoDate: null,
        deliveryAddress: so.deliveryAddress,
        terms: so.terms,
        notes: so.notes,
        priceOverrideReason: "Reorder lines for packing",
        items: reversed.map((i) => ({
          id: i.id,
          description: i.description,
          kind: i.kind,
          qty: i.qty.toFixed(2),
          unit: i.unit,
          unitPrice: i.unitPrice.toFixed(2),
          supplierId: i.supplierId,
          supplierUnitCost: i.supplierUnitCost.toFixed(2),
          withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
          withholdingAtc: i.withholdingAtc,
          withholdingOverride: i.withholdingOverride,
        })),
      } as never,
      admin,
    );

    const view = await getSalesOrderView(so.id, admin);
    expect(view?.changedLineCount).toBe(0);
    expect(view?.items.every((i) => !i.changedVsQuote)).toBe(true);
  });
});
