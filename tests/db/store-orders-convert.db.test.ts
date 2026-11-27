// Store-order conversion (Slice 2) against MySQL 8 (TEST_DATABASE_URL):
// the full money chain (SO = billing = collection = amountPaid to the
// centavo), the booklet SI claim, rollback on an SI collision, double-
// convert refusal, flagged-line resolution, and the quote-less SO
// rendering on the view/print/purchasing surfaces (Gap 1 census legs).

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { createStoreOrderFromApi } from "@/lib/store-orders/intake";
import { convertStoreOrder } from "@/lib/store-orders/convert";
import { getStoreOrderConversionPrep } from "@/lib/store-orders/views";
import { getSettingsSnapshot } from "@/lib/settings";
import { getSalesOrderView } from "@/lib/quotes/views";
import { getSalesOrderPrintModel } from "@/lib/print/views";
import { getCreatePosPreview } from "@/lib/purchasing/views";
import { makeUser, tag } from "./fixtures";

function orderBody(t: string, overrides: Record<string, unknown> = {}) {
  return {
    gateway: { name: "TestPay", paymentRef: `pay-${t}`, idempotencyKey: `gw-${t}` },
    paidAt: "2026-11-27T02:00:00.000Z",
    amountPaid: "1150.00",
    gatewayFee: "17.25",
    deliveryFee: "150.00",
    currency: "PHP",
    buyer: { name: `Web Buyer ${t}`, email: `buyer-${t}@example.com`, phone: "09171234567" },
    deliveryAddress: {
      label: "Home",
      street: "1 Test St",
      barangay: "Brgy Test",
      cityMunicipality: "Pasig",
      province: "Metro Manila",
      zip: "1600",
    },
    lines: [{ sku: null, title: "Test Widget", qty: "2", unit: "pc", unitPrice: "500.00", termEndDate: null }],
    ...overrides,
  };
}

async function intake(t: string, overrides: Record<string, unknown> = {}) {
  const actor = await makeUser("costs");
  const result = await createStoreOrderFromApi(orderBody(t, overrides), actor);
  const row = await db.storeOrder.findUniqueOrThrow({
    where: { id: result.order.id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  return row;
}

async function prepSi(orderId: string): Promise<number> {
  const prep = await getStoreOrderConversionPrep(orderId);
  expect(prep).not.toBeNull();
  expect(prep!.nextSi).not.toBeNull();
  return prep!.nextSi!;
}

describe("store-orders conversion", () => {
  it("converts a matched order end to end: figures to the centavo", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t = tag();
    // Catalogue item + an existing customer whose contact carries the
    // buyer's email, so intake proposes the match.
    const sku = `SKU-${t}`;
    const item = await db.item.create({ data: { name: `Widget ${t}`, sku, kind: "GOODS", unit: "pc" } });
    const customer = await db.customer.create({
      data: { name: `Matched Co ${t}`, withholdingType: "NONE", defaultWithholding: [] },
    });
    await db.contact.create({
      data: { customerId: customer.id, name: `Web Buyer ${t}`, email: `buyer-${t}@example.com`, phone: "09171234567", isMain: true },
    });

    const order = await intake(t, {
      lines: [{ sku, title: `Widget ${t}`, qty: "2", unit: "pc", unitPrice: "500.00", termEndDate: null }],
    });
    expect(order.matchedCustomerId).toBe(customer.id);
    expect(order.lines[0]?.matchFlag).toBe("MAPPED");
    expect(order.lines[0]?.itemId).toBe(item.id);

    const prep = await getStoreOrderConversionPrep(order.id);
    expect(prep).not.toBeNull();
    expect(prep!.lines[0]?.needsPick).toBe(false);
    const si = prep!.nextSi!;
    expect(si).toBeGreaterThanOrEqual(prep!.siRange.from);

    const expenseCountBefore = await db.expense.count();
    const converted = await convertStoreOrder(order.id, { customerMode: "matched", invoiceNo: si }, admin);
    expect(converted.salesOrderNumber).toMatch(/^SO-\d{4}-\d{4}$/);

    const so = await db.salesOrder.findUniqueOrThrow({
      where: { id: converted.salesOrderId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    expect(so.quoteId).toBeNull();
    expect(so.businessId).toBeNull();
    expect(so.customerId).toBe(customer.id);
    expect(so.contractPrice.toFixed(2)).toBe("1150.00");
    expect(so.netReceived.toFixed(2)).toBe("1150.00");
    expect(so.withholdingTotal.toFixed(2)).toBe("0.00");
    expect(so.buyerPoNo).toBeNull();
    expect(so.notes).toContain(order.number);
    expect(so.notes).toContain(`pay-${t}`);
    expect(so.items).toHaveLength(2);
    expect(so.items[0]?.description).toBe(`Widget ${t}`);
    expect(so.items[0]?.total.toFixed(2)).toBe("1000.00");
    expect(so.items[1]?.description).toBe("Delivery fee");
    expect(so.items[1]?.total.toFixed(2)).toBe("150.00");
    // The current settings snapshot is pinned.
    const snap = await getSettingsSnapshot();
    expect(so.settingsVersionId).toBe(snap.versionId);

    const billing = await db.billing.findFirstOrThrow({ where: { salesOrderId: so.id } });
    expect(billing.amount.toFixed(2)).toBe("1150.00");
    expect(billing.invoiceNo).toBe(si);
    expect(billing.status).toBe("PAID");

    const claim = await db.bookletSerialClaim.findUnique({ where: { type_number: { type: "SI", number: si } } });
    expect(claim).not.toBeNull();

    const collection = await db.collection.findFirstOrThrow({
      where: { customerId: customer.id, reference: `pay-${t}` },
      include: { allocations: true },
    });
    expect(collection.method).toBe("GATEWAY");
    expect(collection.amountReceived.toFixed(2)).toBe("1150.00");
    expect(collection.cashAccountId).toBeNull();
    expect(collection.allocations).toHaveLength(1);
    expect(collection.allocations[0]?.billingId).toBe(billing.id);
    expect(collection.allocations[0]?.cashApplied.toFixed(2)).toBe("1150.00");

    const after = await db.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.salesOrderId).toBe(so.id);
    expect(after.convertedById).toBe(admin.id);
    expect(after.convertedAt).not.toBeNull();

    // The matched contact is reused (no duplicate), the delivery address
    // is saved under the customer, and the conversion audit row exists.
    const contacts = await db.contact.count({ where: { customerId: customer.id, email: `buyer-${t}@example.com` } });
    expect(contacts).toBe(1);
    const addresses = await db.address.count({ where: { customerId: customer.id, kind: "DELIVERY" } });
    expect(addresses).toBeGreaterThanOrEqual(1);
    const audit = await db.auditLog.findFirst({
      where: { entityType: "StoreOrder", entityId: order.id, action: "update", userId: admin.id },
    });
    expect(audit).not.toBeNull();

    // The gateway fee is NOT expensed by conversion in this slice:
    // Expense.cashAccountId is a required relation and the fee was
    // withheld from settlement (no cash account). Follow-up tracked in
    // the Slice 2 PR; the fee stays recorded as data on the store order.
    expect(await db.expense.count()).toBe(expenseCountBefore);
    expect(after.gatewayFee.toFixed(2)).toBe("17.25");

    // Census legs: the quote-less SO renders on the detail view, the
    // print model and the Create-POs preview without a quote.
    const view = await getSalesOrderView(so.id, admin);
    expect(view).not.toBeNull();
    expect(view!.quote).toBeNull();
    expect(view!.storeOrder?.number).toBe(order.number);
    const print = await getSalesOrderPrintModel(so.id);
    expect(print).not.toBeNull();
    const poPreview = await getCreatePosPreview(so.id, admin);
    expect(poPreview?.quoteStatus).toBeNull();
  });

  it("creates the customer in new mode (individual, explicit no-withholding)", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t = tag();
    // Unique phone too: the intake cascade matches on phone, and every
    // other test here uses the shared body phone (which by then belongs
    // to a contact created by the matched-order test).
    const order = await intake(t, {
      buyer: { name: `Web Buyer ${t}`, email: `buyer-${t}@example.com`, phone: `0999${t}` },
    });
    expect(order.matchedCustomerId).toBeNull();
    const si = await prepSi(order.id);

    const converted = await convertStoreOrder(
      order.id,
      { customerMode: "new", isIndividual: true, invoiceNo: si, lineItemPicks: { [order.lines[0]!.id]: null } },
      admin,
    );
    const so = await db.salesOrder.findUniqueOrThrow({ where: { id: converted.salesOrderId } });
    const customer = await db.customer.findUniqueOrThrow({ where: { id: so.customerId } });
    expect(customer.name).toBe(`Web Buyer ${t}`);
    expect(customer.withholdingType).toBe("NONE");
    expect(customer.defaultWithholding).toEqual([]);
    expect(customer.isIndividual).toBe(true);
    expect(customer.tin).toBeNull();
    const contact = await db.contact.findFirst({ where: { customerId: customer.id } });
    expect(contact?.email).toBe(`buyer-${t}@example.com`);
    const address = await db.address.findFirst({ where: { customerId: customer.id, kind: "DELIVERY" } });
    expect(address?.street).toBe("1 Test St");
    // The flagged line was resolved as free text (null pick above).
    expect(so.contractPrice.toFixed(2)).toBe("1150.00");
  });

  it("rolls back everything on an SI collision", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t1 = tag();
    const first = await intake(t1, {
      lines: [{ sku: null, title: "Test Widget", qty: "2", unit: "pc", unitPrice: "500.00", termEndDate: null }],
    });
    const si = await prepSi(first.id);
    await convertStoreOrder(
      first.id,
      { customerMode: "new", invoiceNo: si, lineItemPicks: { [first.lines[0]!.id]: null } },
      admin,
    );

    const t2 = tag();
    const second = await intake(t2);
    const counts = {
      so: await db.salesOrder.count(),
      billing: await db.billing.count(),
      collection: await db.collection.count(),
      customer: await db.customer.count(),
    };
    await expect(
      convertStoreOrder(
        second.id,
        { customerMode: "new", invoiceNo: si, lineItemPicks: { [second.lines[0]!.id]: null } },
        admin,
      ),
    ).rejects.toBeInstanceOf(DocRuleError);

    const after = await db.storeOrder.findUniqueOrThrow({ where: { id: second.id } });
    expect(after.status).toBe("PAID");
    expect(after.salesOrderId).toBeNull();
    expect(await db.salesOrder.count()).toBe(counts.so);
    expect(await db.billing.count()).toBe(counts.billing);
    expect(await db.collection.count()).toBe(counts.collection);
    expect(await db.customer.count()).toBe(counts.customer);
    const claims = await db.bookletSerialClaim.count({ where: { type: "SI", number: si } });
    expect(claims).toBe(1);
  });

  it("refuses a double conversion", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t = tag();
    const order = await intake(t);
    const si = await prepSi(order.id);
    await convertStoreOrder(
      order.id,
      { customerMode: "new", invoiceNo: si, lineItemPicks: { [order.lines[0]!.id]: null } },
      admin,
    );
    // The status check fires before any booklet work, so reusing the
    // same SI here still proves the refusal is the double-convert guard.
    await expect(
      convertStoreOrder(
        order.id,
        { customerMode: "new", invoiceNo: si, lineItemPicks: { [order.lines[0]!.id]: null } },
        admin,
      ),
    ).rejects.toBeInstanceOf(DocRuleError);
    const sos = await db.salesOrder.count({ where: { storeOrder: { id: order.id } } });
    expect(sos).toBe(1);
  });

  it("resolves flagged lines by item pick, and keeps free text on a null pick", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t = tag();
    const item = await db.item.create({ data: { name: `Picked ${t}`, sku: `PK-${t}`, kind: "GOODS", unit: "pc" } });

    const orderA = await intake(`${t}a`);
    expect(orderA.lines[0]?.matchFlag).toBe("NO_MATCH");
    const siA = await prepSi(orderA.id);
    // No pick at all → refused, order untouched.
    await expect(
      convertStoreOrder(orderA.id, { customerMode: "new", invoiceNo: siA }, admin),
    ).rejects.toBeInstanceOf(DocRuleError);
    expect((await db.storeOrder.findUniqueOrThrow({ where: { id: orderA.id } })).status).toBe("PAID");
    // Pick the item → the SO line takes the catalogue name.
    const convA = await convertStoreOrder(
      orderA.id,
      { customerMode: "new", invoiceNo: siA, lineItemPicks: { [orderA.lines[0]!.id]: item.id } },
      admin,
    );
    const soA = await db.salesOrder.findUniqueOrThrow({
      where: { id: convA.salesOrderId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    expect(soA.items[0]?.description).toBe(`Picked ${t}`);

    const orderB = await intake(`${t}b`);
    const siB = await prepSi(orderB.id);
    const convB = await convertStoreOrder(
      orderB.id,
      { customerMode: "new", invoiceNo: siB, lineItemPicks: { [orderB.lines[0]!.id]: null } },
      admin,
    );
    const soB = await db.salesOrder.findUniqueOrThrow({
      where: { id: convB.salesOrderId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    expect(soB.items[0]?.description).toBe("Test Widget");
  });

  it("SI pre-fill skips claimed numbers", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const t = tag();
    const order = await intake(t);
    const si = await prepSi(order.id);
    await convertStoreOrder(
      order.id,
      { customerMode: "new", invoiceNo: si, lineItemPicks: { [order.lines[0]!.id]: null } },
      admin,
    );
    const t2 = tag();
    const other = await intake(t2);
    const next = await prepSi(other.id);
    expect(next).not.toBe(si);
  });
});
