import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  seedRefusal,
  demoSeedGuard,
  DEMO_GUARD_MESSAGE,
  DEMO_PRODUCTION_MESSAGE,
  isDemoRequested,
} from "@/lib/seed-guard";
import {
  BASE_SEED_MODELS,
  BUSINESS_MODELS,
  seedBase,
  type BaseSeedDb,
} from "@/lib/seed-base";

describe("seed guard", () => {
  it("refuses sample data in production, even with SEED_SAMPLE=true or SEED_DEMO_STAGING=1", () => {
    expect(seedRefusal({ NODE_ENV: "production", SEED_SAMPLE: "true" })).toMatch(/production/);
    expect(seedRefusal({ NODE_ENV: "production", SEED_DEMO_STAGING: "1" })).toMatch(/production/);
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

  it("refuses when NODE_ENV is production even if SEED_DEMO_STAGING is '1'", () => {
    expect(demoSeedGuard({ NODE_ENV: "production", SEED_DEMO_STAGING: "1" })).toBe(DEMO_PRODUCTION_MESSAGE);
    expect(demoSeedGuard({ NODE_ENV: "production" })).toBe(DEMO_PRODUCTION_MESSAGE);
  });

  it("allows when SEED_DEMO_STAGING is exactly '1' and NODE_ENV is not production", () => {
    expect(demoSeedGuard({ SEED_DEMO_STAGING: "1" })).toBeNull();
    expect(demoSeedGuard({ NODE_ENV: "development", SEED_DEMO_STAGING: "1" })).toBeNull();
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

describe("seed load graph ESM extensions (Release 6 hotfix regression)", () => {
  it("every runtime relative import in the seed load graph has an explicit file extension", () => {
    const root = path.resolve(__dirname, "..");
    const visited = new Set<string>();
    const queue = [
      path.resolve(root, "prisma/seed.mts"),
      path.resolve(root, "prisma/seed-demo.mts"),
    ];

    const offenders: { file: string; specifier: string }[] = [];

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);

      const content = readFileSync(file, "utf8");
      const regex = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["'](\.[^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const specifier = match[1]!;
        const isTypeOnly = /import\s+type\b|export\s+type\b/.test(match[0]);
        if (isTypeOnly) continue; // type-only imports are stripped by Node --experimental-strip-types
        const ext = path.extname(specifier);
        const resolved = path.resolve(path.dirname(file), specifier);

        if (!ext) {
          offenders.push({
            file: path.relative(root, file),
            specifier,
          });
        }

        let target: string | null = null;
        if (ext && existsSync(resolved)) {
          target = resolved;
        } else if (existsSync(`${resolved}.ts`)) {
          target = `${resolved}.ts`;
        } else if (existsSync(`${resolved}.mts`)) {
          target = `${resolved}.mts`;
        }

        if (target && !visited.has(target)) {
          queue.push(target);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("node --experimental-strip-types successfully loads the seed graph modules without ERR_MODULE_NOT_FOUND", () => {
    const root = path.resolve(__dirname, "..");
    const script = `
      Promise.all([
        import("./src/lib/no-delete.ts"),
        import("./src/lib/seed-guard.ts"),
        import("./src/lib/seed-base.ts"),
        import("./prisma/seed-demo.mts"),
      ]).then(() => process.stdout.write("LOADED_OK"));
    `;

    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "-e", script],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: "mysql://nobody:nothing@127.0.0.1:1/none",
        },
      },
    );

    expect(out).toContain("LOADED_OK");
  });
});
