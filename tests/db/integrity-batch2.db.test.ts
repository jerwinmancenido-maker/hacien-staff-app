// Fix batch 2 (2026-11-19): F13 double-convert guard + F21 stale-edit
// guard for customers and items.
// - F13 (Mac run Block 4, S13): two revisions of one quote could each be
//   converted, producing two SOs for one deal. Conversion now refuses
//   when another revision of the chain already won; voiding the SO
//   (which reverts the quote from WON) frees the chain again.
// - F21 (Mac run Block 7, S43/S47): customers and items had no
//   stale-edit guard — an older tab silently overwrote a newer save.
//   The guard follows the document pattern: it runs only when the
//   editor sends its loaded updatedAt token.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { saveCustomer } from "@/lib/services/companies";
import { saveItem } from "@/lib/services/items";
import {
  convertQuoteToSalesOrder,
  copyQuote,
  createQuote,
  type DocActor,
} from "@/lib/services/quotes";
import { voidSalesOrder } from "@/lib/services/sales-orders";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("fix batch 2 integrity (MySQL)", () => {
  let admin: DocActor;

  afterAll(async () => {
    await db.$disconnect();
  });

  it("F13: a second revision of an already-converted deal cannot convert; voiding the SO frees it", async () => {
    admin = await makeUser("costs");
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q1 = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        businessId: null,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: supplier.id, supplierUnitCost: "2000", unitPrice: "5000" },
        ],
      },
      admin,
    );
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so1 = await convertQuoteToSalesOrder(q1.id, { buyerPoNo: `B-F13-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    expect(so1.number).toBeTruthy();

    // Rev 2 of the same deal: converting it must now refuse.
    const q2 = await copyQuote(q1.id, admin, 2);
    expect(q2.revisionChainId).toBe(q1.id);
    await expect(
      convertQuoteToSalesOrder(q2.id, { buyerPoNo: `B-F13B-${tag()}`, deliveryAddressId }, admin, {
        date: new Date(Date.UTC(year, 2, 3)),
      }),
    ).rejects.toThrow(/already converted/);

    // Voiding the SO reverts Rev 1 from WON — Rev 2 may convert now.
    await voidSalesOrder(so1.id, "F13 test cleanup void", admin);
    const so2 = await convertQuoteToSalesOrder(q2.id, { buyerPoNo: `B-F13C-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 4)),
    });
    expect(so2.number).toBeTruthy();
    expect(so2.id).not.toBe(so1.id);
  });

  it("F21: customer saves refuse a stale updatedAt token, accept a fresh one, and allow tokenless saves", async () => {
    admin = await makeUser("costs");
    const customer = await makeCustomer();
    const base = {
      name: customer.name,
      tin: customer.tin,
      withholdingType: customer.withholdingType,
      defaultWithholding: [],
      defaultTerms: customer.defaultTerms ?? "Net 30",
      notes: null,
    };
    const token = customer.updatedAt.toISOString();

    const saved = await saveCustomer(customer.id, { ...base, name: `${customer.name} A`, updatedAt: token }, admin);
    expect(saved.name).toContain(" A");

    // The same token is now stale — the row moved.
    await expect(saveCustomer(customer.id, { ...base, name: `${customer.name} B`, updatedAt: token }, admin)).rejects.toThrow(
      /customer changed while you were editing/,
    );
    const row = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(row.name).toContain(" A");

    // No token (API / older callers): last-writer-wins, as before.
    const saved2 = await saveCustomer(customer.id, { ...base, name: `${customer.name} C` }, admin);
    expect(saved2.name).toContain(" C");
  });

  it("F21: item saves refuse a stale updatedAt token, accept a fresh one, and allow tokenless saves", async () => {
    admin = await makeUser("costs");
    const created = await saveItem(
      null,
      {
        name: `F21 Item ${tag()}`,
        brand: null,
        model: null,
        category: null,
        sku: `F21-${tag()}`.slice(0, 60),
        unit: "pc",
        kind: "GOODS",
        details: null,
        defaultUnitPrice: "100.00",
      },
      admin.id,
    );
    const token = created.updatedAt.toISOString();
    const base = {
      name: created.name,
      brand: null,
      model: null,
      category: null,
      sku: created.sku,
      unit: "pc",
      kind: "GOODS" as const,
      details: null,
      defaultUnitPrice: "120.00",
    };
    const saved = await saveItem(created.id, { ...base, defaultUnitPrice: "110.00", updatedAt: token }, admin.id);
    expect(String(saved.defaultUnitPrice)).toContain("110");

    await expect(saveItem(created.id, { ...base, updatedAt: token }, admin.id)).rejects.toThrow(
      /item changed while you were editing/,
    );
    const row = await db.item.findUniqueOrThrow({ where: { id: created.id } });
    expect(String(row.defaultUnitPrice)).toContain("110");

    const saved2 = await saveItem(created.id, { ...base, defaultUnitPrice: "130.00" }, admin.id);
    expect(String(saved2.defaultUnitPrice)).toContain("130");
  });
});
