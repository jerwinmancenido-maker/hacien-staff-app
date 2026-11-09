// /api/v1 foundation against MySQL 8 (TEST_DATABASE_URL). Keys are generated
// at runtime; nothing here is a real secret.

import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  process.env.API_KEY_PEPPER = Buffer.from(bytes).toString("hex");
  return { hasDb: !!url };
});

import { GET as getHealth } from "@/app/api/v1/health/route";
import { GET as getCustomer, PATCH as patchCustomer } from "@/app/api/v1/customers/[id]/route";
import { GET as listCustomersRoute, POST as postCustomer } from "@/app/api/v1/customers/route";
import { GET as getItemRoute } from "@/app/api/v1/items/[id]/route";
import { GET as listItemsRoute } from "@/app/api/v1/items/route";
import { ApiError } from "@/lib/api/errors";
import { hashRequestBody, IDEMPOTENCY_PENDING_MS, IDEMPOTENCY_TTL_MS, settleIdempotentWrite } from "@/lib/api/idempotency";
import { generateApiKey } from "@/lib/api/keys";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { saveItem } from "@/lib/services/items";
import { makeUser, tag } from "./fixtures";

const pepperAtStart = process.env.API_KEY_PEPPER;

afterEach(() => {
  process.env.API_KEY_PEPPER = pepperAtStart;
});

function idemKey(): string {
  return `idem-${randomBytes(8).toString("hex")}`;
}

async function issueKey(
  userId: string,
  scopes: string[],
  extra: { revokedAt?: Date; expiresAt?: Date } = {},
) {
  const generated = generateApiKey();
  const row = await db.apiKey.create({
    data: {
      name: `Test key ${tag()}`,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      scopes,
      actingUserId: userId,
      revokedAt: extra.revokedAt ?? null,
      expiresAt: extra.expiresAt ?? null,
    },
  });
  return { id: row.id, token: generated.token, prefix: generated.keyPrefix };
}

function request(pathname: string, token: string | null, init: { method?: string; body?: unknown; idem?: string | null; ip?: string } = {}) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.idem) headers.set("idempotency-key", init.idem);
  if (init.ip) headers.set("x-forwarded-for", init.ip);
  return new NextRequest(`http://localhost${pathname}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function terms(): Promise<string> {
  const { settings } = await getSettingsSnapshot();
  const term = settings.lists.paymentTerms[0];
  if (!term) throw new Error("settings have no payment terms");
  return term;
}

function customerBody(name: string, term: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    tin: "",
    withholdingType: "NONE",
    defaultWithholding: [],
    defaultTerms: term,
    notes: "api",
    isIndividual: false,
    orderTextUpdates: true,
    ...extra,
  };
}

describe("api v1", () => {
  it("rejects a bad key, and the log line has the prefix only", async () => {
    if (!env.hasDb) return;
    const token = randomBytes(32).toString("base64url");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await getHealth(request("/api/v1/health", token));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("unauthorized");
      const logged = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain(token.slice(0, 8));
      expect(logged).not.toContain(token);
      expect(JSON.stringify(body)).not.toContain(token);
    } finally {
      spy.mockRestore();
    }
  });

  it("fails closed when the pepper is unset", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const key = await issueKey(admin.id, ["customers:read", "items:read"]);
    delete process.env.API_KEY_PEPPER;
    try {
      const res = await getHealth(request("/api/v1/health", key.token));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("pepper_unset");
      expect(JSON.stringify(body)).not.toContain(key.token);
    } finally {
      process.env.API_KEY_PEPPER = pepperAtStart;
    }
  });

  it("rejects a revoked key and an expired key", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const revoked = await issueKey(admin.id, ["customers:read"], { revokedAt: new Date() });
    const expired = await issueKey(admin.id, ["customers:read"], { expiresAt: new Date(Date.now() - 60_000) });
    const revokedRes = await getHealth(request("/api/v1/health", revoked.token));
    expect(revokedRes.status).toBe(401);
    expect((await revokedRes.json()).error.code).toBe("revoked");
    const expiredRes = await getHealth(request("/api/v1/health", expired.token));
    expect(expiredRes.status).toBe(401);
    expect((await expiredRes.json()).error.code).toBe("expired");
  });

  it("rejects a key whose acting user is inactive", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    await db.user.update({ where: { id: admin.id }, data: { active: false } });
    const key = await issueKey(admin.id, ["full"]);
    const res = await getHealth(request("/api/v1/health", key.token));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("rejects a missing scope and a UI permission the acting user does not have", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const viewer = await makeUser("viewer");
    const readOnly = await issueKey(admin.id, ["items:read"]);
    const viewerWrite = await issueKey(viewer.id, ["customers:write"]);
    const missing = await listCustomersRoute(request("/api/v1/customers", readOnly.token));
    expect(missing.status).toBe(403);
    expect((await missing.json()).error.code).toBe("forbidden");
    const term = await terms();
    const denied = await postCustomer(
      request("/api/v1/customers", viewerWrite.token, {
        method: "POST",
        idem: idemKey(),
        body: customerBody(`Denied ${tag()}`, term),
      }),
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.message).toMatch(/permission/i);
  });

  it("serves health, customers, and items for a valid key", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const viewer = await makeUser("viewer");
    const key = await issueKey(admin.id, ["customers:read", "customers:write", "items:read"]);
    const viewerKey = await issueKey(viewer.id, ["customers:read"]);
    const health = await getHealth(request("/api/v1/health", key.token));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, data: { status: "ok" } });

    const term = await terms();
    const name = `API Customer ${tag()}`;
    const digits = (randomBytes(4).readUInt32BE(0) % 1_000_000_000).toString().padStart(9, "0");
    const tin = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-000`;
    const created = await postCustomer(
      request("/api/v1/customers", key.token, {
        method: "POST",
        idem: idemKey(),
        ip: "203.0.113.9",
        body: customerBody(name, term, { tin, notes: "created" }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.ok).toBe(true);
    expect(createdBody.data.customer.name).toBe(name);
    expect(createdBody.data.customer.tin).toBeTruthy();
    expect(JSON.stringify(createdBody)).not.toContain(key.token);
    const id = createdBody.data.customer.id as string;

    const audit = await db.auditLog.findFirst({ where: { entityType: "Customer", entityId: id, action: "create" } });
    expect(audit?.userId).toBe(admin.id);
    expect(audit?.apiKeyId).toBe(key.id);
    expect(audit?.ip).toBe("203.0.113.9");
    expect(JSON.stringify(audit)).not.toContain(key.token);

    const auditsBeforeRead = await db.auditLog.count({ where: { entityId: id } });
    const listed = await listCustomersRoute(request(`/api/v1/customers?q=${encodeURIComponent(name)}`, key.token));
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.data.customers.map((c: { id: string }) => c.id)).toContain(id);
    expect(listedBody.data.limit).toBeLessThanOrEqual(100);
    const one = await getCustomer(request(`/api/v1/customers/${id}`, key.token), { params: Promise.resolve({ id }) });
    expect(one.status).toBe(200);
    expect((await one.json()).data.customer.id).toBe(id);
    expect(await db.auditLog.count({ where: { entityId: id } })).toBe(auditsBeforeRead);

    const hidden = await listCustomersRoute(request(`/api/v1/customers?q=${encodeURIComponent(name)}`, viewerKey.token));
    expect(hidden.status).toBe(200);
    const hiddenBody = await hidden.json();
    const hiddenRow = hiddenBody.data.customers.find((c: { id: string; tin?: string }) => c.id === id) as { tin?: string } | undefined;
    if (!hiddenRow) throw new Error("viewer list missed the customer");
    expect(hiddenRow.tin).toBeUndefined();
    expect(JSON.stringify(hiddenBody)).not.toContain(tin);

    const capped = await listCustomersRoute(request("/api/v1/customers?limit=1000", key.token));
    expect((await capped.json()).data.limit).toBe(100);
    const badLimit = await listCustomersRoute(request("/api/v1/customers?limit=0", key.token));
    expect(badLimit.status).toBe(400);

    const sku = `SKU-${tag()}`;
    const item = await saveItem(
      null,
      { name: `API Item ${tag()}`, brand: null, model: null, category: null, sku, unit: "pc", kind: "GOODS", details: null, defaultUnitPrice: "10.00" },
      admin.id,
    );
    const items = await listItemsRoute(request(`/api/v1/items?q=${encodeURIComponent(sku)}`, key.token));
    expect(items.status).toBe(200);
    const itemsBody = await items.json();
    expect(itemsBody.data.items.map((row: { id: string }) => row.id)).toEqual([item.id]);
    const listedItem = itemsBody.data.items[0] as { defaultUnitPrice?: string; supplierUnitCost?: string } | undefined;
    if (!listedItem) throw new Error("item list missed the item");
    expect(listedItem.defaultUnitPrice).toBe("10.00");
    expect(listedItem.supplierUnitCost).toBeUndefined();
    const itemOne = await getItemRoute(request(`/api/v1/items/${item.id}`, key.token), { params: Promise.resolve({ id: item.id }) });
    expect(itemOne.status).toBe(200);
    const missingItem = await getItemRoute(request("/api/v1/items/missing-item", key.token), { params: Promise.resolve({ id: "missing-item" }) });
    expect(missingItem.status).toBe(404);
  });

  it("requires Idempotency-Key, replays a duplicate, and conflicts when the body differs", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const key = await issueKey(admin.id, ["customers:write", "customers:read"]);
    const term = await terms();
    const name = `Idem Customer ${tag()}`;
    const missing = await postCustomer(request("/api/v1/customers", key.token, { method: "POST", body: customerBody(name, term) }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("idempotency_key_required");

    const idem = idemKey();
    const body = customerBody(name, term, { notes: "first" });
    const first = await postCustomer(request("/api/v1/customers", key.token, { method: "POST", idem, ip: "203.0.113.10", body }));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const second = await postCustomer(request("/api/v1/customers", key.token, { method: "POST", idem, body }));
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotency-replayed")).toBe("true");
    const secondBody = await second.json();
    expect(secondBody.data.customer.id).toBe(firstBody.data.customer.id);
    expect(await db.customer.count({ where: { name } })).toBe(1);

    const conflict = await postCustomer(
      request("/api/v1/customers", key.token, { method: "POST", idem, body: customerBody(name, term, { notes: "changed" }) }),
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("idempotency_conflict");
    expect(await db.customer.count({ where: { name } })).toBe(1);

    const id = firstBody.data.customer.id as string;
    const renamed = `Renamed ${tag()}`;
    const patched = await patchCustomer(request(`/api/v1/customers/${id}`, key.token, { method: "PATCH", ip: "203.0.113.11", body: { name: renamed } }), {
      params: Promise.resolve({ id }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.customer.name).toBe(renamed);
    const row = await db.customer.findUnique({ where: { id } });
    expect(row?.notes).toBe("first");
    const updateAudit = await db.auditLog.findFirst({ where: { entityType: "Customer", entityId: id, action: "update" } });
    expect(updateAudit?.apiKeyId).toBe(key.id);
    expect(updateAudit?.userId).toBe(admin.id);
  });

  it("keeps a non-admin from changing withholding", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const staff = await makeUser("staff");
    const adminKey = await issueKey(admin.id, ["customers:write"]);
    const staffKey = await issueKey(staff.id, ["customers:write"]);
    const term = await terms();
    const created = await postCustomer(
      request("/api/v1/customers", adminKey.token, { method: "POST", idem: idemKey(), body: customerBody(`WH ${tag()}`, term) }),
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).data.customer.id as string;
    const res = await patchCustomer(
      request(`/api/v1/customers/${id}`, staffKey.token, {
        method: "PATCH",
        body: { withholdingType: "GOVERNMENT", defaultWithholding: [] },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("rule");
    const row = await db.customer.findUnique({ where: { id } });
    expect(row?.withholdingType).toBe("NONE");
  });

  it("returns 429 with Retry-After when the read or write bucket is full", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const readKey = await issueKey(admin.id, ["customers:read", "customers:write"]);
    const writeKey = await issueKey(admin.id, ["customers:write"]);
    const now = new Date();
    await db.apiCallLog.createMany({
      data: Array.from({ length: 120 }, () => ({
        apiKeyId: readKey.id,
        method: "GET",
        path: "/api/v1/health",
        status: 200,
        kind: "read",
        at: now,
      })),
    });
    const limited = await getHealth(request("/api/v1/health", readKey.token));
    expect(limited.status).toBe(429);
    const retry = Number(limited.headers.get("retry-after"));
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect((await limited.json()).error.code).toBe("rate_limited");

    const term = await terms();
    const stillWrites = await postCustomer(
      request("/api/v1/customers", readKey.token, {
        method: "POST",
        idem: idemKey(),
        body: customerBody(`Read bucket ${tag()}`, term),
      }),
    );
    expect(stillWrites.status).toBe(201);

    await db.apiCallLog.createMany({
      data: Array.from({ length: 30 }, () => ({
        apiKeyId: writeKey.id,
        method: "POST",
        path: "/api/v1/customers",
        status: 201,
        kind: "write",
        at: now,
      })),
    });
    const writeLimited = await postCustomer(
      request("/api/v1/customers", writeKey.token, {
        method: "POST",
        idem: idemKey(),
        body: customerBody(`Write bucket ${tag()}`, term),
      }),
    );
    expect(writeLimited.status).toBe(429);
    expect(Number(writeLimited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const healthStill = await getHealth(request("/api/v1/health", writeKey.token));
    expect(healthStill.status).toBe(200);
  });

  it("does not let 429 rows keep a client blocked after the counted requests age out", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const key = await issueKey(admin.id, ["customers:read"]);
    const countedAt = new Date(Date.now() - 50_000);
    await db.apiCallLog.createMany({
      data: Array.from({ length: 120 }, () => ({
        apiKeyId: key.id,
        method: "GET",
        path: "/api/v1/health",
        status: 200,
        kind: "read",
        at: countedAt,
      })),
    });
    const limited = await getHealth(request("/api/v1/health", key.token));
    expect(limited.status).toBe(429);
    const retry = Number(limited.headers.get("retry-after"));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(15);

    await db.apiCallLog.createMany({
      data: Array.from({ length: 120 }, () => ({
        apiKeyId: key.id,
        method: "GET",
        path: "/api/v1/health",
        status: 429,
        kind: "read",
        at: new Date(),
      })),
    });
    await db.apiCallLog.updateMany({
      where: { apiKeyId: key.id, status: 200 },
      data: { at: new Date(Date.now() - 61_000) },
    });
    const afterWait = await getHealth(request("/api/v1/health", key.token));
    expect(afterWait.status).toBe(200);
  });

  it("a viewer key cannot match or see a hidden TIN", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const viewer = await makeUser("viewer");
    const adminKey = await issueKey(admin.id, ["customers:read", "customers:write"]);
    const viewerKey = await issueKey(viewer.id, ["customers:read"]);
    const term = await terms();
    const digits = (randomBytes(4).readUInt32BE(0) % 1_000_000_000).toString().padStart(9, "0");
    const tin = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-000`;
    const name = `HiddenTinCustomer${randomBytes(4).toString("hex").replace(/[0-9]/g, "x")}`;
    const created = await postCustomer(
      request("/api/v1/customers", adminKey.token, { method: "POST", idem: idemKey(), body: customerBody(name, term, { tin, notes: "hidden" }) }),
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).data.customer.id as string;

    const byTin = await listCustomersRoute(request(`/api/v1/customers?q=${encodeURIComponent(tin)}`, viewerKey.token));
    expect(byTin.status).toBe(200);
    const byTinBody = await byTin.json();
    expect(byTinBody.data.customers.map((c: { id: string }) => c.id)).not.toContain(id);
    expect(JSON.stringify(byTinBody)).not.toContain(tin);

    const byName = await listCustomersRoute(request(`/api/v1/customers?q=${encodeURIComponent(name)}`, viewerKey.token));
    const byNameBody = await byName.json();
    const named = byNameBody.data.customers.find((c: { id: string }) => c.id === id) as { tin?: string } | undefined;
    if (!named) throw new Error("viewer name search missed the customer");
    expect(named.tin).toBeUndefined();
    expect(JSON.stringify(byNameBody)).not.toContain(tin);

    const detail = await getCustomer(request(`/api/v1/customers/${id}`, viewerKey.token), { params: Promise.resolve({ id }) });
    const detailBody = await detail.json();
    expect(detailBody.data.customer.tin).toBeUndefined();
    expect(JSON.stringify(detailBody)).not.toContain(tin);

    const staff = await listCustomersRoute(request(`/api/v1/customers?q=${encodeURIComponent(tin)}`, adminKey.token));
    const staffBody = await staff.json();
    const found = staffBody.data.customers.find((c: { id: string; tin?: string }) => c.id === id) as { tin?: string } | undefined;
    if (!found) throw new Error("staff TIN search missed the customer");
    expect(found.tin).toBe(tin);
  });

  it("retries a stale idempotency claim, expires a finished one, and rolls the write back with the record", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const key = await issueKey(admin.id, ["customers:write"]);
    const term = await terms();

    const pendingName = `Pending ${tag()}`;
    const pendingBody = customerBody(pendingName, term);
    const pendingKey = idemKey();
    await db.apiCallLog.create({
      data: {
        apiKeyId: key.id,
        method: "POST",
        path: "/api/v1/customers",
        status: 0,
        kind: "write",
        idempotencyKey: pendingKey,
        requestHash: hashRequestBody(pendingBody),
        at: new Date(),
      },
    });
    const blocked = await postCustomer(request("/api/v1/customers", key.token, { method: "POST", idem: pendingKey, body: pendingBody }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("idempotency_in_progress");
    expect(await db.customer.count({ where: { name: pendingName } })).toBe(0);

    await db.apiCallLog.updateMany({
      where: { apiKeyId: key.id, idempotencyKey: pendingKey },
      data: { at: new Date(Date.now() - IDEMPOTENCY_PENDING_MS - 1000) },
    });
    const recovered = await postCustomer(request("/api/v1/customers", key.token, { method: "POST", idem: pendingKey, body: pendingBody }));
    expect(recovered.status).toBe(201);
    expect(recovered.headers.get("idempotency-replayed")).toBeNull();
    expect(await db.customer.count({ where: { name: pendingName } })).toBe(1);
    const settled = await db.apiCallLog.findFirst({ where: { apiKeyId: key.id, idempotencyKey: pendingKey } });
    expect(settled?.status).toBe(201);
    expect(settled?.responseJson).not.toBeNull();

    const idem = idemKey();
    const expiredName = `Expired ${tag()}`;
    const expiredBody = customerBody(expiredName, term);
    const first = await postCustomer(request("/api/v1/customers", key.token, { method: "POST", idem, body: expiredBody }));
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.customer.id as string;
    await db.apiCallLog.updateMany({
      where: { apiKeyId: key.id, idempotencyKey: idem },
      data: { at: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 1000) },
    });
    const again = await postCustomer(request("/api/v1/customers", key.token, { method: "POST", idem, body: expiredBody }));
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotency-replayed")).toBeNull();
    const againId = (await again.json()).data.customer.id as string;
    expect(againId).not.toBe(firstId);
    expect(await db.customer.count({ where: { name: expiredName } })).toBe(2);

    const orphan = await db.apiCallLog.create({
      data: { apiKeyId: key.id, method: "POST", path: "/api/v1/customers", status: 0, kind: "write" },
    });
    const rolledName = `Rolled ${tag()}`;
    await expect(
      db.$transaction(async (tx) => {
        await tx.customer.create({
          data: { name: rolledName, withholdingType: "NONE", defaultWithholding: [], defaultTerms: null },
        });
        await settleIdempotentWrite(tx, {
          logId: orphan.id,
          idempotencyKey: idemKey(),
          status: 201,
          body: { ok: true },
        });
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(await db.customer.findFirst({ where: { name: rolledName } })).toBeNull();
    const orphanAfter = await db.apiCallLog.findUnique({ where: { id: orphan.id } });
    expect(orphanAfter?.status).toBe(0);
    expect(orphanAfter?.responseJson).toBeNull();
  });
});
