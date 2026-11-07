// Step 2: the item detail — every document line for one item, newest
// first, with the document it came from; where-used dedupes documents;
// supplier comparison is cheapest first.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { groupItemDocuments, listItemDetailEntries, listSupplierPriceComparison } from "@/lib/items/history";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { createStandalonePurchaseOrder } from "@/lib/services/purchase-orders";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("item detail entries", () => {
  let admin: DocActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-item-detail-uploads-"));
    [admin] = await Promise.all([makeUser("costs")]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("lists quote, SO and PO lines newest-first and dedupes where-used", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const [supplierA, supplierB] = await Promise.all([makeSupplier(), makeSupplier()]);
    // The test DB is shared with every other suite, and the fixtures use
    // "Laptop i5" everywhere — the description must be unique to this test.
    const desc = `Laptop i5 ${tag()}`;
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          { id: null, description: desc, kind: "GOODS", qty: "2", unit: "pc", supplierId: null, supplierUnitCost: "45000", unitPrice: "52000" },
          { id: null, description: desc, kind: "GOODS", qty: "1", unit: "pc", supplierId: null, supplierUnitCost: "45000", unitPrice: "51000" },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(
      q.id,
      { buyerPoNo: `PO-DETAIL-${tag()}`, deliveryAddressId },
      admin,
      { date: new Date(Date.UTC(year, 2, 16)) },
    );
    const poA = await createStandalonePurchaseOrder(
      {
        supplierId: supplierA.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 17)),
        expectedDate: null,
        terms: null,
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: desc, kind: "GOODS", qty: "1", unit: "pc", unitCost: "45000" }],
      },
      admin,
    );
    const poB = await createStandalonePurchaseOrder(
      {
        supplierId: supplierB.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 18)),
        expectedDate: null,
        terms: null,
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: desc, kind: "GOODS", qty: "1", unit: "pc", unitCost: "43000" }],
      },
      admin,
    );

    const entries = await listItemDetailEntries(desc);
    // Two quote lines + two SO lines + two PO lines, newest first by date.
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort().reverse());
    expect(entries[0]!.docKind).toBe("purchase_order");
    expect(entries[0]!.docId).toBe(poB.id);
    expect(entries[0]!.cost).toBe("43000");
    expect(entries.filter((e) => e.docKind === "quote").map((e) => e.price)).toEqual(["52000", "51000"]);
    expect(entries.filter((e) => e.docKind === "sales_order").map((e) => e.docId)).toEqual([so.id, so.id]);
    expect(entries.filter((e) => e.docKind === "purchase_order").map((e) => e.docId).sort()).toEqual([poA.id, poB.id].sort());

    // Where-used: one row per document, even though the quote and the SO
    // each carry two lines of the item.
    const docs = groupItemDocuments(entries);
    expect(docs).toHaveLength(4);
    expect(docs.map((d) => d.docKind).sort()).toEqual(["purchase_order", "purchase_order", "quote", "sales_order"]);
    expect(docs.find((d) => d.docKind === "quote")!.docId).toBe(q.id);

    // Supplier comparison: cheapest first.
    const suppliers = await listSupplierPriceComparison(desc);
    expect(suppliers.map((s) => s.lastCost)).toEqual(["43000", "45000"]);
    expect(suppliers[0]!.supplierName).toBe(supplierB.name);

    // A longer name is a different item, and matching is case-insensitive.
    expect(await listItemDetailEntries(`${desc} Pro`)).toEqual([]);
    expect(await listItemDetailEntries(desc.toLowerCase())).toHaveLength(6);
  });

  it("returns nothing for a description with no lines", async () => {
    expect(await listItemDetailEntries(`No such item ${tag()}`)).toEqual([]);
    expect(groupItemDocuments([])).toEqual([]);
  });
});
