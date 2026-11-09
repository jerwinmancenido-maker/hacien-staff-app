import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditActorLabel } from "@/lib/audit-log";
import { writeAudit } from "@/lib/audit";
import { runWithApiContext } from "@/lib/api/context";
import { ApiError } from "@/lib/api/errors";
import { API_LIMIT_MAX, parsePageLimit } from "@/lib/api/http";
import { hashRequestBody, judgeIdempotency, parseIdempotencyKey } from "@/lib/api/idempotency";
import { API_KEY_PREFIX_LEN, generateApiKey, hashApiKey, maskApiKeyForLog } from "@/lib/api/keys";
import { hasScope } from "@/lib/api/scopes";
import type { Tx } from "@/lib/db";

const previousPepper = process.env.API_KEY_PEPPER;

afterEach(() => {
  if (previousPepper === undefined) delete process.env.API_KEY_PEPPER;
  else process.env.API_KEY_PEPPER = previousPepper;
});

describe("API key pepper and hash", () => {
  it("fails closed when API_KEY_PEPPER is unset", () => {
    delete process.env.API_KEY_PEPPER;
    const token = randomBytes(32).toString("base64url");
    expect(() => hashApiKey(token)).toThrow(ApiError);
    try {
      hashApiKey(token);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(503);
      expect((e as ApiError).code).toBe("pepper_unset");
      expect((e as Error).message).not.toContain(token);
      expect((e as Error).message).not.toContain("API_KEY_PEPPER");
    }
  });

  it("fails closed when the pepper is too short", () => {
    process.env.API_KEY_PEPPER = "short";
    expect(() => generateApiKey()).toThrow(ApiError);
  });

  it("hashes with the pepper and masks only the prefix", () => {
    const pepper = randomBytes(32).toString("hex");
    process.env.API_KEY_PEPPER = pepper;
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.token).not.toBe(a.keyHash);
    expect(a.keyPrefix).toBe(a.token.slice(0, API_KEY_PREFIX_LEN));
    expect(a.keyHash).toHaveLength(64);
    expect(a.keyHash).toBe(hashApiKey(a.token));
    expect(a.keyHash).not.toBe(b.keyHash);
    expect(maskApiKeyForLog(a.token)).toBe(a.keyPrefix);
    expect(maskApiKeyForLog(a.token)).not.toBe(a.token);
    const otherPepper = randomBytes(32).toString("hex");
    process.env.API_KEY_PEPPER = otherPepper;
    expect(hashApiKey(a.token)).not.toBe(a.keyHash);
  });
});

describe("API scopes", () => {
  it("matches a module scope, coarse read/write, and full", () => {
    expect(hasScope(["customers:read"], "customers:read")).toBe(true);
    expect(hasScope(["customers:read"], "customers:write")).toBe(false);
    expect(hasScope(["customers:write"], "customers:read")).toBe(false);
    expect(hasScope(["items:read"], "customers:read")).toBe(false);
    expect(hasScope(["read"], "customers:read")).toBe(true);
    expect(hasScope(["read"], "customers:write")).toBe(false);
    expect(hasScope(["write"], "customers:write")).toBe(true);
    expect(hasScope(["full"], "items:read")).toBe(true);
    expect(hasScope([], "customers:read")).toBe(false);
  });
});

describe("API list window", () => {
  it("defaults page and limit and caps limit at 100", () => {
    expect(parsePageLimit(new URLSearchParams())).toEqual({ ok: true, page: 1, limit: 50 });
    expect(parsePageLimit(new URLSearchParams("page=2&limit=1000"))).toEqual({ ok: true, page: 2, limit: API_LIMIT_MAX });
    expect(parsePageLimit(new URLSearchParams("limit=0")).ok).toBe(false);
    expect(parsePageLimit(new URLSearchParams("page=0")).ok).toBe(false);
    expect(parsePageLimit(new URLSearchParams("page=1.5")).ok).toBe(false);
  });
});

describe("Idempotency-Key", () => {
  it("requires a usable key and hashes a body independent of key order", () => {
    expect(() => parseIdempotencyKey(null)).toThrow(ApiError);
    expect(() => parseIdempotencyKey("short")).toThrow(ApiError);
    expect(parseIdempotencyKey("idem-12345678")).toBe("idem-12345678");
    expect(hashRequestBody({ b: 1, a: { d: 2, c: 3 } })).toBe(hashRequestBody({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashRequestBody({ a: 1 })).not.toBe(hashRequestBody({ a: 2 }));
  });

  it("replays the same request and conflicts when the body differs", () => {
    const stored = {
      requestHash: "abc",
      method: "POST",
      path: "/api/v1/customers",
      status: 201,
      responseJson: { ok: true, data: { customer: { id: "c1" } } },
    };
    expect(judgeIdempotency(stored, { requestHash: "abc", method: "POST", path: "/api/v1/customers" })).toEqual({
      type: "replay",
      status: 201,
      body: stored.responseJson,
    });
    expect(judgeIdempotency(stored, { requestHash: "other", method: "POST", path: "/api/v1/customers" }).type).toBe("conflict");
    expect(judgeIdempotency({ ...stored, status: 0, responseJson: null }, { requestHash: "abc", method: "POST", path: "/api/v1/customers" }).type).toBe(
      "in_progress",
    );
  });
});

describe("audit attribution", () => {
  it("labels the acting user and the API key", () => {
    expect(auditActorLabel("API / Bot", "Owner bot")).toBe("API / Bot (via API key Owner bot)");
    expect(auditActorLabel("Ada", null)).toBe("Ada");
    expect(auditActorLabel(null, "Owner bot")).toBeNull();
    expect(auditActorLabel("API / Bot", "line\nbreak")).toBe("API / Bot (via API key line break)");
  });

  it("writes apiKeyId from the request context and clears it afterwards", async () => {
    const calls: Record<string, unknown>[] = [];
    const tx = {
      auditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          calls.push(args.data);
        },
      },
    } as unknown as Tx;
    const input = { userId: "user-1", entityType: "Customer" as const, entityId: "cust-1", action: "create" as const, after: { name: "A" } };
    await runWithApiContext({ apiKeyId: "key-1", ip: "203.0.113.9" }, async () => {
      await writeAudit(tx, input);
    });
    await writeAudit(tx, input);
    expect(calls[0]).toMatchObject({ userId: "user-1", apiKeyId: "key-1", ip: "203.0.113.9", entityId: "cust-1" });
    expect(calls[1]).toMatchObject({ userId: "user-1", apiKeyId: null, ip: null });
    expect(JSON.stringify(calls)).not.toMatch(/hk_|Bearer /);
  });
});

describe("v1 route surface", () => {
  it("does not expose money or email actions", () => {
    const root = path.resolve("src/app/api/v1");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".ts")) files.push(p);
      }
    };
    walk(root);
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/collections|supplier-payments|billings|sendMail|approveQuote|voidQuote/);
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+DELETE\b/);
    expect(files.map((f) => path.relative(root, f)).sort()).toEqual([
      "customers/[id]/route.ts",
      "customers/route.ts",
      "health/route.ts",
      "items/[id]/route.ts",
      "items/route.ts",
    ]);
  });
});
