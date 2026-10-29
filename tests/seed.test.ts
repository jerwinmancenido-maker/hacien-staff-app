import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { seedRefusal } from "@/lib/seed-guard";

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
});
