import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateUniqueTrackingRef, isTrackingRef, newTrackingRef, newTrackingRefBits } from "@/lib/tracking-ref";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-93 random tracking references", () => {
  it("mints TRK- + 16 base32 chars (80 bits)", () => {
    for (let i = 0; i < 50; i++) {
      const ref = newTrackingRef();
      expect(ref).toMatch(/^TRK-[A-Z2-7]{16}$/);
      expect(isTrackingRef(ref)).toBe(true);
    }
    const refs = new Set(Array.from({ length: 100 }, () => newTrackingRefBits()));
    expect(refs.size).toBe(100);
  });

  it("rejects non-tracking shapes", () => {
    expect(isTrackingRef(null)).toBe(false);
    expect(isTrackingRef("SO-2026-0004")).toBe(false);
    expect(isTrackingRef("TRK-ABC")).toBe(false);
    expect(isTrackingRef("TRK-AAAAAAAAAAAAAAAA")).toBe(true);
    expect(isTrackingRef("TRK-AAAAAAAAAAAAAAAA0")).toBe(false);
  });

  it("retries on collision and gives up after attempts", async () => {
    let calls = 0;
    const ref = await generateUniqueTrackingRef(async () => {
      calls += 1;
      return calls < 3;
    });
    expect(isTrackingRef(ref)).toBe(true);
    expect(calls).toBe(3);
    await expect(generateUniqueTrackingRef(async () => true, 2)).rejects.toThrow("unique tracking reference");
  });

  it("new sales orders get a tracking ref at creation; the SO number is untouched", () => {
    const conversion = src("src/lib/services/quotes.ts");
    expect(conversion).toContain("generateUniqueTrackingRef");
    expect(conversion).toContain("trackingRef,");
    expect(src("src/lib/quotes/views.ts")).toContain("trackingRef: so.trackingRef");
    expect(src("src/app/(app)/sales-orders/[id]/page.tsx")).toContain("<dt>Tracking ref</dt>");
  });

  it("migration is additive: nullable unique column, old orders keep working", () => {
    const migration = src("prisma/migrations/20261105020000_s93_tracking_ref/migration.sql");
    expect(migration).toContain("ADD COLUMN `trackingRef` VARCHAR(24) NULL");
    expect(migration).toContain("CREATE UNIQUE INDEX");
    expect(migration).not.toContain("DROP");
    const schema = src("prisma/schema.prisma");
    expect(schema).toContain("trackingRef");
  });
});
