// SL-05: warranties ending soon query — VOID receiving reports are excluded.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { addDays, manilaToday } from "@/lib/format";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import {
  approvePurchaseOrder,
  createPurchaseOrdersFromSalesOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { postReceivingReport, voidReceivingReport } from "@/lib/services/receiving";
import { countWarrantiesEndingSoon, listWarrantiesEndingSoon } from "@/lib/purchasing/views";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("SL-05 warranties ending soon (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;

  beforeAll(async () => {
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("lists POSTED warranty lines in the 30-day window and excludes VOID receiving reports", async () => {
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
          { id: null, description: `Laptop soon ${tag()}`, kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "1000", unitPrice: "1500" },
          { id: null, description: `Mouse voided ${tag()}`, kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "200" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "SL-05 test", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "SL05", deliveryAddressId: delivAddr.id }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    await approvePurchaseOrder(po!.id, admin);
    await markPurchaseOrderSent(po!.id, admin);
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po!.id }, orderBy: { sortOrder: "asc" } });

    const now = manilaToday(new Date(`${year}-06-15T12:00:00+08:00`));
    const soonEnd = addDays(now, 10);
    const voidEnd = addDays(now, 5);

    const posted = await postReceivingReport(
      po!.id,
      {
        receivedDate: new Date(Date.UTC(year, 3, 1)),
        receivedById: staff.id,
        deliveryRef: "DR-SL05-A",
        notes: null,
        lines: [{ lineId: lines[0]!.id, qty: "1", warrantyEndDate: soonEnd.toISOString().slice(0, 10), serialNumbers: "SN-SOON-1" }],
      },
      staff,
    );
    expect(posted.status).toBe("POSTED");

    const voided = await postReceivingReport(
      po!.id,
      {
        receivedDate: new Date(Date.UTC(year, 3, 2)),
        receivedById: staff.id,
        deliveryRef: "DR-SL05-B",
        notes: null,
        lines: [{ lineId: lines[1]!.id, qty: "1", warrantyEndDate: voidEnd.toISOString().slice(0, 10), serialNumbers: "SN-VOID-1" }],
      },
      staff,
    );
    await voidReceivingReport(voided.id, "Wrong count", admin);

    // Removed PO line with a still-POSTED warranty must not appear.
    const removedEnd = addDays(now, 7);
    await postReceivingReport(
      po!.id,
      {
        receivedDate: new Date(Date.UTC(year, 3, 3)),
        receivedById: staff.id,
        deliveryRef: "DR-SL05-C",
        notes: null,
        lines: [{ lineId: lines[1]!.id, qty: "1", warrantyEndDate: removedEnd.toISOString().slice(0, 10), serialNumbers: "SN-REMOVED" }],
      },
      staff,
    );
    await db.purchaseOrderItem.update({ where: { id: lines[1]!.id }, data: { removedAt: new Date() } });

    const rows = await listWarrantiesEndingSoon({ now });
    const ours = rows.filter((r) => r.purchaseOrderId === po!.id);
    expect(ours.map((r) => r.serialNumbers)).toEqual(["SN-SOON-1"]);
    expect(ours[0]!.warrantyEndDate).toBe(soonEnd.toISOString().slice(0, 10));
    expect(ours[0]!.salesOrderNumber).toBe(so.number);
    expect(ours.some((r) => r.serialNumbers === "SN-VOID-1")).toBe(false);
    expect(ours.some((r) => r.serialNumbers === "SN-REMOVED")).toBe(false);

    const count = await countWarrantiesEndingSoon(now);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(rows.filter((r) => r.purchaseOrderId === po!.id)).toHaveLength(1);
  });

  it("filters by q — PO number, supplier, or serial (Bugbot fix on PR #202)", async () => {
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
          { id: null, description: `Server q ${tag()}`, kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "1000", unitPrice: "1500" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "SL-05 q test", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "SL05Q", deliveryAddressId: delivAddr.id }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    await approvePurchaseOrder(po!.id, admin);
    await markPurchaseOrderSent(po!.id, admin);
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po!.id } });
    const serial = `SN-Q-${tag()}`;
    const now = manilaToday(new Date(`${year}-06-15T12:00:00+08:00`));
    await postReceivingReport(
      po!.id,
      {
        receivedDate: new Date(Date.UTC(year, 3, 1)),
        receivedById: staff.id,
        deliveryRef: "DR-SL05-Q",
        notes: null,
        lines: [{ lineId: lines[0]!.id, qty: "1", warrantyEndDate: addDays(now, 9).toISOString().slice(0, 10), serialNumbers: serial }],
      },
      staff,
    );

    const ours = (rows: { purchaseOrderId: string }[]) => rows.filter((r) => r.purchaseOrderId === po!.id);
    // Serial fragment, PO number, and supplier name each find the row…
    expect(ours(await listWarrantiesEndingSoon({ now, q: serial.slice(0, 8) }))).toHaveLength(1);
    expect(ours(await listWarrantiesEndingSoon({ now, q: po!.number }))).toHaveLength(1);
    const supplierRow = await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
    expect(ours(await listWarrantiesEndingSoon({ now, q: supplierRow.name.slice(0, 6) }))).toHaveLength(1);
    // …and a term that matches nothing on this PO leaves it out.
    expect(ours(await listWarrantiesEndingSoon({ now, q: `ZZ-NOMATCH-${tag()}` }))).toHaveLength(0);
  });
});
