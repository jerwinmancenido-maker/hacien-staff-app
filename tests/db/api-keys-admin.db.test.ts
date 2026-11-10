// REQ-API-001 PR-B — API key admin service + the API / Bot acting user,
// against MySQL 8 (TEST_DATABASE_URL). Keys are generated at runtime with a
// throwaway pepper; nothing here is a real secret.

import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  process.env.API_KEY_PEPPER = Buffer.from(bytes).toString("hex");
  return { hasDb: !!url };
});

import { API_BOT_EMAIL, ensureApiBotUser, getApiBotUser } from "@/lib/api/bot-user";
import { ApiError } from "@/lib/api/errors";
import { authenticateBearer } from "@/lib/api/keys";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api/keys-admin";
import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { can, canSeeTin } from "@/lib/permissions";
import { makeUser, tag } from "./fixtures";

const pepperAtStart = process.env.API_KEY_PEPPER;

afterEach(() => {
  process.env.API_KEY_PEPPER = pepperAtStart;
});

const META = { method: "GET", path: "/api/v1/customers", kind: "read" as const };

describe.skipIf(!env.hasDb)("API / Bot user", () => {
  it("is created once with the plan-v2 flags and can never sign in", async () => {
    const first = await ensureApiBotUser();
    const second = await ensureApiBotUser();
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
    const bot = await getApiBotUser();
    expect(bot).not.toBeNull();
    expect(bot!.email).toBe(API_BOT_EMAIL);
    expect(bot!.active).toBe(true);
    expect(bot!.passwordHash).toBeNull();
    expect(bot!.isAdmin).toBe(false);
    expect(bot!.isApprover).toBe(false);
    expect(bot!.isStaff).toBe(true);
    expect(bot!.canSeeCosts).toBe(false);
    const flags = {
      id: bot!.id,
      isAdmin: bot!.isAdmin,
      isApprover: bot!.isApprover,
      isStaff: bot!.isStaff,
      isViewer: bot!.isViewer,
      active: bot!.active,
      canSeeCosts: bot!.canSeeCosts,
    };
    expect(can(flags, "view")).toBe(true);
    expect(can(flags, "edit_data")).toBe(true);
    expect(can(flags, "manage_billing")).toBe(false);
    expect(can(flags, "approve")).toBe(false);
    expect(can(flags, "manage_settings")).toBe(false);
    expect(canSeeTin(flags)).toBe(true);
  });
});

describe.skipIf(!env.hasDb)("API key admin", () => {
  it("creates a key whose token authenticates as the API / Bot user; the token is never stored or audited", async () => {
    const admin = await makeUser("costs");
    const made = await createApiKey({ name: `Sync key ${tag()}`, scopes: ["customers:read"], expiresAt: null, actorId: admin.id });
    expect(made.token.length).toBeGreaterThan(20);
    const row = await db.apiKey.findUnique({ where: { id: made.id } });
    expect(row).not.toBeNull();
    expect(row!.keyHash).not.toBe(made.token);
    expect(JSON.stringify(row)).not.toContain(made.token);
    const bot = await getApiBotUser();
    expect(row!.actingUserId).toBe(bot!.id);

    const authed = await authenticateBearer(`Bearer ${made.token}`, META);
    expect(authed.apiKeyId).toBe(made.id);
    expect(authed.user.id).toBe(bot!.id);
    expect(authed.scopes).toEqual(["customers:read"]);

    const audits = await db.auditLog.findMany({ where: { entityType: "Settings", entityId: made.id, action: "create" } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.after)).not.toContain(made.token);
    expect(JSON.stringify(audits[0]!.after)).toContain(made.keyPrefix);
  });

  it("revoke kills access immediately and writes an audit row; the key row is kept", async () => {
    const admin = await makeUser("costs");
    const made = await createApiKey({ name: `Revoke key ${tag()}`, scopes: ["read"], expiresAt: null, actorId: admin.id });
    await expect(authenticateBearer(`Bearer ${made.token}`, META)).resolves.toBeTruthy();
    await revokeApiKey({ id: made.id, actorId: admin.id });
    const err = await authenticateBearer(`Bearer ${made.token}`, META).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("revoked");
    const row = await db.apiKey.findUnique({ where: { id: made.id } });
    expect(row).not.toBeNull();
    expect(row!.revokedAt).not.toBeNull();
    const audits = await db.auditLog.findMany({ where: { entityType: "Settings", entityId: made.id, action: "update" } });
    expect(audits).toHaveLength(1);
    await expect(revokeApiKey({ id: made.id, actorId: admin.id })).rejects.toBeInstanceOf(DocRuleError);
  });

  it("an expired key is refused; a key with only bogus scopes is refused at creation; pepper unset fails closed", async () => {
    const admin = await makeUser("costs");
    const made = await createApiKey({
      name: `Expiry key ${tag()}`,
      scopes: ["read"],
      expiresAt: new Date(Date.now() - 60_000),
      actorId: admin.id,
    });
    const err = await authenticateBearer(`Bearer ${made.token}`, META).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("expired");

    await expect(
      createApiKey({ name: `Bogus key ${tag()}`, scopes: ["not-a-scope"], expiresAt: null, actorId: admin.id }),
    ).rejects.toBeInstanceOf(DocRuleError);

    delete process.env.API_KEY_PEPPER;
    await expect(
      createApiKey({ name: `Pepper key ${tag()}`, scopes: ["read"], expiresAt: null, actorId: admin.id }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("lists keys with status and never exposes the hash", async () => {
    const admin = await makeUser("costs");
    const name = `Listed key ${tag()}`;
    await createApiKey({ name, scopes: ["items:read", "bogus"], expiresAt: null, actorId: admin.id });
    const rows = await listApiKeys();
    const mine = rows.find((r) => r.name === name);
    expect(mine).toBeTruthy();
    expect(mine!.status).toBe("active");
    expect(mine!.scopes).toEqual(["items:read"]);
    expect(JSON.stringify(mine)).not.toContain("keyHash");
  });
});
