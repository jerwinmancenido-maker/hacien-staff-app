// Duplicate-SKU guard (final-check finding F4): saveItem refuses a SKU that
// another catalog item already owns (case-insensitive), naming the owner;
// the owning item may keep its own SKU, and blank SKUs never collide.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { ItemRuleError, saveItem } from "@/lib/services/items";
import type { ItemInput } from "@/lib/validation/items";
import { makeUser, tag } from "./fixtures";

function itemInput(name: string, sku: string | null): ItemInput {
  return {
    name,
    brand: null,
    model: null,
    category: null,
    sku,
    unit: "pc",
    kind: "GOODS",
    details: null,
    defaultUnitPrice: null,
  };
}

describe.skipIf(!env.hasDb)("item SKU uniqueness guard (MySQL)", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("blocks duplicate SKUs on create and update, allows the owner and blanks", async () => {
    const admin = await makeUser("costs");
    const t = tag();
    const sku = `SKU-GUARD-${t}`;

    const owner = await saveItem(null, itemInput(`SKU owner ${t}`, sku), admin.id);
    expect(owner.sku).toBe(sku);

    // Create with the same SKU in a different case: refused, naming the owner.
    await expect(saveItem(null, itemInput(`SKU copy ${t}`, sku.toLowerCase()), admin.id)).rejects.toMatchObject({
      name: "ItemRuleError",
      field: "sku",
      message: `SKU ${sku.toLowerCase()} is already used by SKU owner ${t}.`,
    });

    // A different item updated onto the SKU: refused too.
    const other = await saveItem(null, itemInput(`SKU other ${t}`, `SKU-OTHER-${t}`), admin.id);
    await expect(saveItem(other.id, itemInput(`SKU other ${t}`, sku), admin.id)).rejects.toBeInstanceOf(ItemRuleError);

    // The owner keeps its own SKU while editing other fields.
    const renamed = await saveItem(owner.id, itemInput(`SKU owner renamed ${t}`, sku), admin.id);
    expect(renamed.name).toBe(`SKU owner renamed ${t}`);

    // Blank SKUs never collide.
    const blankA = await saveItem(null, itemInput(`Blank SKU A ${t}`, null), admin.id);
    const blankB = await saveItem(null, itemInput(`Blank SKU B ${t}`, null), admin.id);
    expect(blankA.id).not.toBe(blankB.id);
  });
});
