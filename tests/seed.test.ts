import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  seedRefusal,
  demoSeedGuard,
  DEMO_GUARD_MESSAGE,
  isDemoRequested,
} from "@/lib/seed-guard";
import {
  BASE_SEED_MODELS,
  BUSINESS_MODELS,
  seedBase,
  type BaseSeedDb,
} from "@/lib/seed-base";

describe("seed guard", () => {
  it("refuses sample data in production, even with SEED_SAMPLE=true", () => {
    expect(seedRefusal({ NODE_ENV: "production", SEED_SAMPLE: "true" })).toMatch(/production/);
  });

  it("refuses unless SEED_SAMPLE=true", () => {
    expect(seedRefusal({ NODE_ENV: "development" })).toMatch(/SEED_SAMPLE=true/);
    expect(seedRefusal({ NODE_ENV: "development", SEED_SAMPLE: "1" })).toMatch(/SEED_SAMPLE=true/);
    expect(seedRefusal({ NODE_ENV: "development", SEED_SAMPLE: "true" })).toBeNull();
    expect(seedRefusal({ SEED_SAMPLE: "true" })).toBeNull();
  });

  it("the seed script checks the guard and never logs passwords", () => {
    const src = readFileSync(path.resolve(__dirname, "../prisma/seed.mts"), "utf8");
    expect(src).toMatch(/seedRefusal\(process\.env\)/);
    const logged = [...src.matchAll(/console\.(log|info|warn|error)\(([^;]*)\);/g)].map((m) => m[2]);
    expect(logged.length).toBeGreaterThan(0);
    for (const args of logged) expect(args).not.toMatch(/password/i);
  });

  it("seed.mts runs seedBase before any demo refusal return", () => {
    const src = readFileSync(path.resolve(__dirname, "../prisma/seed.mts"), "utf8");
    const baseIdx = src.indexOf("await seedBase(db)");
    const demoGuardIdx = src.indexOf("demoSeedGuard(process.env)");
    expect(baseIdx).toBeGreaterThan(-1);
    expect(demoGuardIdx).toBeGreaterThan(baseIdx);
  });
});

describe("demo seed guard", () => {
  it("refuses when SEED_DEMO_STAGING is unset", () => {
    expect(demoSeedGuard({})).toBe(DEMO_GUARD_MESSAGE);
    expect(demoSeedGuard({ SEED_DEMO_STAGING: undefined })).toBe(DEMO_GUARD_MESSAGE);
  });

  it("refuses when SEED_DEMO_STAGING is '0'", () => {
    expect(demoSeedGuard({ SEED_DEMO_STAGING: "0" })).toBe(DEMO_GUARD_MESSAGE);
  });

  it("refuses when SEED_DEMO_STAGING is other than '1'", () => {
    expect(demoSeedGuard({ SEED_DEMO_STAGING: "true" })).toBe(DEMO_GUARD_MESSAGE);
    expect(demoSeedGuard({ SEED_DEMO_STAGING: "yes" })).toBe(DEMO_GUARD_MESSAGE);
    expect(demoSeedGuard({ SEED_DEMO_STAGING: "2" })).toBe(DEMO_GUARD_MESSAGE);
    expect(demoSeedGuard({ SEED_DEMO_STAGING: "staging" })).toBe(DEMO_GUARD_MESSAGE);
  });

  it("allows when SEED_DEMO_STAGING is exactly '1'", () => {
    expect(demoSeedGuard({ SEED_DEMO_STAGING: "1" })).toBeNull();
  });

  it("isDemoRequested is true only for explicit demo opt-ins", () => {
    expect(isDemoRequested({})).toBe(false);
    expect(isDemoRequested({ SEED_DEMO_STAGING: "0" })).toBe(false);
    expect(isDemoRequested({ SEED_DEMO_STAGING: "true" })).toBe(false);
    expect(isDemoRequested({ SEED_DEMO_STAGING: "1" })).toBe(true);
    expect(isDemoRequested({ SEED_DEMO: "1" })).toBe(true);
    expect(isDemoRequested({ SEED_SAMPLE: "true" })).toBe(true);
    expect(isDemoRequested({ SEED_SAMPLE: "1" })).toBe(false);
  });

  it("the demo seed script checks the guard and never logs passwords", () => {
    const src = readFileSync(path.resolve(__dirname, "../prisma/seed-demo.mts"), "utf8");
    expect(src).toMatch(/demoSeedGuard\(process\.env\)/);
    const logged = [...src.matchAll(/console\.(log|info|warn|error)\(([^;]*)\);/g)].map((m) => m[2]);
    expect(logged.length).toBeGreaterThan(0);
    for (const args of logged) expect(args).not.toMatch(/password/i);
  });
});

describe("base seed plan creates no business records", () => {
  it("manifest contains only system models and no business models", () => {
    for (const m of BASE_SEED_MODELS) {
      expect((BUSINESS_MODELS as readonly string[]).includes(m)).toBe(false);
    }
    expect(BASE_SEED_MODELS).toContain("settingsVersion");
    expect(BASE_SEED_MODELS).toContain("user");
    expect(BASE_SEED_MODELS).toContain("withholdingRate");
  });

  it("seedBase writes settings defaults, admin user, withholding rates and zero business records", async () => {
    const calls: { model: string; method: string }[] = [];

    // Proxy-based mock for prisma db client
    const createModelProxy = (modelName: string) => {
      return new Proxy(
        {},
        {
          get: (_target, prop: string) => {
            return async () => {
              calls.push({ model: modelName, method: prop });
              if (prop === "count") return 0;
              if (prop === "findUnique" || prop === "findFirst") return null;
              if (prop === "findMany") return [];
              return { id: "mock-id" };
            };
          },
        },
      );
    };

    const mockDb = new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === "$transaction") {
            return async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb);
          }
          if (prop === "$disconnect") {
            return async () => {};
          }
          return createModelProxy(prop);
        },
      },
    ) as unknown as BaseSeedDb;

    await seedBase(mockDb);

    // Verify operations occurred on base models
    const modelsCalled = new Set(calls.map((c) => c.model));
    expect(modelsCalled.has("settingsVersion")).toBe(true);
    expect(modelsCalled.has("user")).toBe(true);
    expect(modelsCalled.has("withholdingRate")).toBe(true);

    // Assert that NO calls were made to any business models
    for (const biz of BUSINESS_MODELS) {
      expect(modelsCalled.has(biz)).toBe(false);
    }

    // Explicitly verify customer, supplier, quote, salesOrder, billing were never touched
    const touchedBusinessModels = calls.filter((c) =>
      [
        "customer",
        "supplier",
        "quote",
        "salesOrder",
        "billing",
        "collection",
        "payment",
        "expense",
        "purchaseOrder",
      ].includes(c.model.toLowerCase()),
    );
    expect(touchedBusinessModels).toEqual([]);
  });
});
