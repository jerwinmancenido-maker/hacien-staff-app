// F36 (found by REQ-HACIEN-MAC-TEST-005, 2026-11-20): creating an item
// through saveItemAction silently failed because the action sent the
// stale-edit token as "" on creates and the schema's datetime check
// rejected it — the error never reached the UI. PR #246 added the token;
// its tests exercised the service (tokenless = fine) but never the action.
// These tests call the ACTION itself, the layer that broke.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally without it.

import { beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

const actor = vi.hoisted(() => ({ id: "" }));

vi.mock("@/lib/auth/current-user", () => ({
  requireActionPermission: async () => ({ id: actor.id }),
  requireUser: async () => ({ id: actor.id }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { db } from "@/lib/db";
import { saveItemAction } from "@/app/(app)/items/actions";
import { makeUser, tag } from "./fixtures";

const run = env.hasDb ? describe : describe.skip;

function itemForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("name", fields.name ?? `F36 Item ${tag()}`);
  fd.set("brand", fields.brand ?? "");
  fd.set("model", fields.model ?? "");
  fd.set("category", fields.category ?? "");
  fd.set("sku", fields.sku ?? "");
  fd.set("unit", fields.unit ?? "pc");
  fd.set("kind", fields.kind ?? "GOODS");
  fd.set("details", fields.details ?? "");
  fd.set("defaultUnitPrice", fields.defaultUnitPrice ?? "");
  if (fields.updatedAt !== undefined) fd.set("updatedAt", fields.updatedAt);
  return fd;
}

run("saveItemAction (F36)", () => {
  beforeAll(async () => {
    const admin = await makeUser("costs");
    actor.id = admin.id;
  });

  it("creates an item when the form carries no stale-edit token (the F36 case)", async () => {
    const sku = `F36-CREATE-${tag()}`;
    const result = await saveItemAction(null, {}, itemForm({ sku }));
    expect(result.fieldErrors?.updatedAt).toBeUndefined();
    expect(result.ok).toBe(true);
    const item = await db.item.findFirst({ where: { sku } });
    expect(item).not.toBeNull();
    expect(item?.name).toContain("F36 Item");
  });

  it("refuses a duplicate SKU in a different letter case, naming the existing item", async () => {
    const sku = `F36-DUP-${tag()}`;
    const first = await saveItemAction(null, {}, itemForm({ sku, name: `F36 Original ${tag()}` }));
    expect(first.ok).toBe(true);
    const dupe = await saveItemAction(null, {}, itemForm({ sku: sku.toLowerCase(), name: `F36 Copy ${tag()}` }));
    expect(dupe.ok).toBeUndefined();
    const errText = dupe.fieldErrors?.sku ?? dupe.message ?? "";
    expect(errText).toContain("already used by");
    expect(errText).toContain("F36 Original");
    const rows = await db.item.findMany({ where: { sku: { equals: sku } } });
    expect(rows).toHaveLength(1);
  });

  it("edit with the matching token saves; edit with a stale token is refused", async () => {
    const sku = `F36-EDIT-${tag()}`;
    const created = await saveItemAction(null, {}, itemForm({ sku, name: `F36 Before ${tag()}` }));
    expect(created.ok).toBe(true);
    const item = await db.item.findFirstOrThrow({ where: { sku } });
    const token = item.updatedAt.toISOString();

    const stale = await saveItemAction(item.id, {}, itemForm({ sku, name: "F36 Stale Write", updatedAt: new Date(0).toISOString() }));
    expect(stale.ok).toBeUndefined();
    expect(stale.message ?? "").toMatch(/changed while you were editing/i);
    const afterStale = await db.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(afterStale.name).not.toBe("F36 Stale Write");

    const fresh = await saveItemAction(item.id, {}, itemForm({ sku, name: "F36 After Edit", updatedAt: token }));
    expect(fresh.ok).toBe(true);
    const afterFresh = await db.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(afterFresh.name).toBe("F36 After Edit");
  });
});
