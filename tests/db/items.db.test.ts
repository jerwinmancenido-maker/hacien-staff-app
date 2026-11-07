// Item catalog, Step 1. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { listItems, saveItem, setItemActive } from "@/lib/services/items";
import { makeUser } from "./fixtures";

const base = {
  name: "Anthropic Claude Max 5x Plan",
  brand: "Anthropic",
  model: "Claude Max 5x",
  category: "Software",
  sku: "CLAUDE-MAX-5X",
  unit: "pc",
  kind: "GOODS" as const,
  details: "12 months",
  defaultUnitPrice: "133333.33",
};

describe("item catalog", () => {
  it("creates, updates, deactivates and reactivates an item, with audit rows", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const created = await saveItem(null, base, admin.id);
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Anthropic Claude Max 5x Plan");
    expect(created.active).toBe(true);
    expect(created.defaultUnitPrice?.toFixed(2)).toBe("133333.33");

    const createAudit = await db.auditLog.findFirst({
      where: { entityType: "Item", entityId: created.id, action: "create" },
    });
    expect(createAudit).not.toBeNull();

    const updated = await saveItem(created.id, { ...base, name: "Anthropic Claude Max 5x Plan (renewal)" }, admin.id);
    expect(updated.name).toBe("Anthropic Claude Max 5x Plan (renewal)");
    const updateAudit = await db.auditLog.findFirst({
      where: { entityType: "Item", entityId: created.id, action: "update" },
    });
    expect(updateAudit).not.toBeNull();

    const inactive = await setItemActive(created.id, false, admin.id);
    expect(inactive.active).toBe(false);
    const archiveAudit = await db.auditLog.findFirst({
      where: { entityType: "Item", entityId: created.id, action: "archive" },
    });
    expect(archiveAudit).not.toBeNull();

    const active = await setItemActive(created.id, true, admin.id);
    expect(active.active).toBe(true);
  });

  it("lists by search across name, brand, model, category and SKU, and hides inactive by default", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const stamp = Date.now().toString(36);
    const a = await saveItem(null, { ...base, name: `Catalog Search A ${stamp}`, sku: `CSA-${stamp}` }, admin.id);
    const b = await saveItem(null, { ...base, name: `Catalog Search B ${stamp}`, brand: `Brand ${stamp}`, sku: null }, admin.id);

    const bySku = await listItems({ q: `CSA-${stamp}` });
    expect(bySku.map((i) => i.id)).toEqual([a.id]);
    const byBrand = await listItems({ q: `Brand ${stamp}` });
    expect(byBrand.map((i) => i.id)).toEqual([b.id]);

    await setItemActive(a.id, false, admin.id);
    const activeOnly = await listItems({ q: stamp });
    expect(activeOnly.map((i) => i.id)).toEqual([b.id]);
    const withInactive = await listItems({ q: stamp, includeInactive: true });
    expect(withInactive.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });
});
