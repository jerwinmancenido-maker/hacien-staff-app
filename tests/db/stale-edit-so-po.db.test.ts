// Stale-edit guard (REQ-HACIEN-BACKLOG-001 item 4): updateSalesOrder /
// updatePurchaseOrder refuse a save whose loaded updatedAt no longer matches,
// leave the row unchanged, and still accept a fresh token. Runs on MySQL 8
// (TEST_DATABASE_URL); skipped locally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { DocRuleError, STALE_EDIT_MESSAGE } from "@/lib/documents/common";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { updateSalesOrder } from "@/lib/services/sales-orders";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  updatePurchaseOrder,
} from "@/lib/services/purchase-orders";
import type { PoInput } from "@/lib/validation/purchasing";
import type { SalesOrderInput } from "@/lib/validation/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("stale-edit guard for sales orders and purchase orders (MySQL)", () => {
  let admin: DocActor;
  let approver: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
    const t = tag();
    approver = await db.user.create({
      data: { email: `approver-stale-${t}@test.example.com`, name: `Approver stale ${t}`, isApprover: true, canSeeCosts: true },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function openSo() {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const quote = await createQuote(quoteInput(customer.id, year, {}, supplier.id), admin);
    await approveQuote(quote.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    return convertQuoteToSalesOrder(
      quote.id,
      { buyerPoNo: `B-${tag()}`, deliveryAddressId },
      admin,
      { date: new Date(Date.UTC(year, 2, 2)) },
    );
  }

  async function soPayload(soId: string, notes: string): Promise<SalesOrderInput> {
    const so = await db.salesOrder.findUniqueOrThrow({ where: { id: soId } });
    const rows = await db.salesOrderItem.findMany({
      where: { salesOrderId: soId, removedAt: null },
      orderBy: { sortOrder: "asc" },
    });
    return {
      contactId: so.contactId,
      buyerPoNo: so.buyerPoNo,
      buyerPoDate: so.buyerPoDate ?? undefined,
      deliveryAddress: so.deliveryAddress,
      terms: so.terms,
      notes,
      updatedAt: so.updatedAt.toISOString(),
      items: rows.map((i) => ({
        id: i.id,
        description: i.description,
        kind: i.kind,
        qty: i.qty.toFixed(2),
        unit: i.unit,
        unitPrice: i.unitPrice.toFixed(2),
        supplierId: i.supplierId,
        supplierUnitCost: i.supplierUnitCost.toFixed(2),
        withholdingRate: i.withholdingRate != null ? i.withholdingRate.toFixed(4) : null,
        withholdingAtc: i.withholdingAtc,
        withholdingOverride: i.withholdingOverride,
      })),
    };
  }

  async function draftPo() {
    const year = await freshYear();
    const supplier = await makeSupplier();
    return createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 1)),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: "1 Warehouse Rd",
        supplierAddressText: null,
        notes: "stale-edit seed",
        items: [{ id: null, description: "Cable", kind: "GOODS", qty: "2", unit: "pc", unitCost: "100.00" }],
      },
      admin,
    );
  }

  async function poPayload(poId: string, notes: string): Promise<PoInput> {
    const po = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: poId },
      include: { items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    return {
      supplierId: po.supplierId,
      supplierContactId: po.supplierContactId,
      date: po.date,
      expectedDate: po.expectedDate,
      terms: po.terms,
      deliveryAddressText: po.deliveryAddressText,
      supplierAddressText: po.supplierAddressText,
      notes,
      updatedAt: po.updatedAt.toISOString(),
      items: po.items.map((i) => ({
        id: i.id,
        description: i.description,
        kind: i.kind,
        qty: i.qty.toFixed(2),
        unit: i.unit,
        unitCost: i.unitCost.toFixed(2),
      })),
    };
  }

  it("refuses a stale sales-order save and accepts a fresh one", async () => {
    const so = await openSo();
    const stale = await soPayload(so.id, "first editor");
    const first = await updateSalesOrder(so.id, await soPayload(so.id, "winner"), admin);
    expect(first.notes).toBe("winner");

    const before = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
    await expect(updateSalesOrder(so.id, { ...stale, notes: "stale overwrite" }, admin)).rejects.toBeInstanceOf(DocRuleError);
    await expect(updateSalesOrder(so.id, { ...stale, notes: "stale overwrite" }, admin)).rejects.toThrow(STALE_EDIT_MESSAGE);

    const afterStale = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect(afterStale.notes).toBe("winner");
    expect(afterStale.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(afterStale.contractPrice.toFixed(2)).toBe(before.contractPrice.toFixed(2));

    const fresh = await updateSalesOrder(so.id, await soPayload(so.id, "reloaded editor"), admin);
    expect(fresh.notes).toBe("reloaded editor");
  });

  it("refuses a stale purchase-order save (no approval clear) and accepts a fresh one", async () => {
    const po = await draftPo();
    await approvePurchaseOrder(po.id, approver);
    const approved = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.revision).toBe(1);

    const stale = await poPayload(po.id, "stale token");
    // Another editor saves first — bumps updatedAt and clears approval.
    const winner = await updatePurchaseOrder(po.id, await poPayload(po.id, "winner"), admin);
    expect(winner.notes).toBe("winner");
    expect(winner.status).toBe("DRAFT");
    expect(winner.revision).toBe(2);

    // Re-approve so the stale attempt targets an approved row again.
    await approvePurchaseOrder(po.id, approver);
    const reapproved = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(reapproved.status).toBe("APPROVED");
    expect(reapproved.revision).toBe(2);

    await expect(updatePurchaseOrder(po.id, { ...stale, notes: "stale overwrite" }, admin)).rejects.toThrow(
      STALE_EDIT_MESSAGE,
    );
    const afterStale = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(afterStale.notes).toBe(reapproved.notes);
    expect(afterStale.status).toBe("APPROVED");
    expect(afterStale.revision).toBe(2);
    expect(afterStale.approvedById).toBe(reapproved.approvedById);
    expect(afterStale.updatedAt.getTime()).toBe(reapproved.updatedAt.getTime());

    const fresh = await updatePurchaseOrder(po.id, await poPayload(po.id, "reloaded editor"), admin);
    expect(fresh.notes).toBe("reloaded editor");
    expect(fresh.status).toBe("DRAFT");
    expect(fresh.revision).toBe(3);
  });
});
