// Catalog Step 3: quote lines link to catalog items (or create one on save).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { createQuote, copyQuote, updateQuote, type DocActor } from "@/lib/services/quotes";
import { searchCatalogItems } from "@/lib/items/search";
import { freshYear, makeCustomer, makeUser, quoteInput, tag } from "./fixtures";

describe.skipIf(!hasDb)("quote item catalog link (MySQL)", () => {
  let costUser: DocActor;
  let customerId: string;
  let year: number;

  beforeAll(async () => {
    costUser = await makeUser("costs");
    const customer = await makeCustomer();
    customerId = customer.id;
    year = await freshYear();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function catalogItem(name: string) {
    return db.item.create({
      data: { name, brand: "TestBrand", model: "T-1", category: "Test", sku: `SKU-${tag()}`, unit: "pc", kind: "GOODS", defaultUnitPrice: "12345.00" },
    });
  }

  it("persists a picked catalog link on create", async () => {
    const item = await catalogItem(`Picker Item ${tag()}`);
    const input = quoteInput(customerId, year);
    input.items[0]!.description = item.name;
    input.items[0]!.itemId = item.id;
    const q = await createQuote(input, costUser);
    const line = await db.quoteItem.findFirst({ where: { quoteId: q.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    expect(line?.itemId).toBe(item.id);
  });

  it("creates a catalog item from typed fields and links the line", async () => {
    const name = `New Catalog Item ${tag()}`;
    const input = quoteInput(customerId, year);
    input.items[0]!.description = name;
    input.items[0]!.newCatalog = { brand: "Acme", model: "X9", category: "Widgets", sku: `ACME-${tag()}`, details: "12 months" };
    const q = await createQuote(input, costUser);
    const line = await db.quoteItem.findFirst({ where: { quoteId: q.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    expect(line?.itemId).not.toBeNull();
    const created = await db.item.findUnique({ where: { id: line!.itemId! } });
    expect(created?.name).toBe(name);
    expect(created?.brand).toBe("Acme");
    expect(created?.details).toBe("12 months");
    expect(created?.unit).toBe(input.items[0]!.unit);
  });

  it("leaves a plain free-text line unlinked when no catalog fields are typed", async () => {
    const input = quoteInput(customerId, year);
    const q = await createQuote(input, costUser);
    const line = await db.quoteItem.findFirst({ where: { quoteId: q.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    expect(line?.itemId).toBeNull();
  });

  it("rejects a link to an item that does not exist", async () => {
    const input = quoteInput(customerId, year);
    input.items[0]!.itemId = "no-such-item";
    await expect(createQuote(input, costUser)).rejects.toBeInstanceOf(DocRuleError);
  });

  it("links on update, clears on unlink, and copyQuote carries the link", async () => {
    const item = await catalogItem(`Update Link Item ${tag()}`);
    const input = quoteInput(customerId, year);
    const q = await createQuote(input, costUser);
    const lineId = (await db.quoteItem.findFirst({ where: { quoteId: q.id, removedAt: null }, orderBy: { sortOrder: "asc" } }))!.id;

    // Link on update.
    const updateInput = quoteInput(customerId, year);
    updateInput.items[0]!.id = lineId;
    updateInput.items[0]!.itemId = item.id;
    const updated = await updateQuote(q.id, updateInput, costUser);
    expect(updated.items[0]!.itemId).toBe(item.id);

    // Unlink on update.
    const unlinkInput = quoteInput(customerId, year);
    unlinkInput.items[0]!.id = lineId;
    unlinkInput.items[0]!.itemId = null;
    const unlinked = await updateQuote(q.id, unlinkInput, costUser);
    expect(unlinked.items[0]!.itemId).toBeNull();

    // Copy carries the link.
    const relinkInput = quoteInput(customerId, year);
    relinkInput.items[0]!.id = lineId;
    relinkInput.items[0]!.itemId = item.id;
    await updateQuote(q.id, relinkInput, costUser);
    const copy = await copyQuote(q.id, costUser, 1);
    expect(copy.items[0]!.itemId).toBe(item.id);
  });

  it("search finds by name/brand/model/SKU, skips inactive, and needs 2 chars", async () => {
    const name = `Searchable Widget ${tag()}`;
    const item = await catalogItem(name);
    const inactive = await db.item.create({
      data: { name: `Inactive Widget ${tag()}`, unit: "pc", kind: "GOODS", active: false },
    });
    expect((await searchCatalogItems("x")).length).toBe(0);
    const byName = await searchCatalogItems(name.slice(0, 12));
    expect(byName.some((r) => r.id === item.id)).toBe(true);
    expect(byName.some((r) => r.id === inactive.id)).toBe(false);
    const bySku = await searchCatalogItems(item.sku!);
    expect(bySku.some((r) => r.id === item.id)).toBe(true);
    const byBrand = await searchCatalogItems("TestBrand");
    expect(byBrand.some((r) => r.id === item.id)).toBe(true);
  });
});
