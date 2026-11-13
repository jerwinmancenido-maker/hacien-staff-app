import { describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the PR #214 staging panic ("timer has gone away" on
 * session.findUnique, debian-openssl-1.1.x engine): src/lib/db.ts must cache
 * the Prisma client on globalThis in EVERY environment, including
 * production — otherwise a bundle that loads db.ts in more than one chunk
 * copy creates several PrismaClient/engine instances per process, and a
 * torn-down instance can leave queries routed to a dropped runtime.
 */
describe("db global cache", () => {
  it("assigns globalThis.prisma even when NODE_ENV=production", async () => {
    const g = globalThis as unknown as { prisma?: unknown };
    const prevPrisma = g.prisma;
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      delete g.prisma;
      const m = await import("@/lib/db");
      expect(g.prisma).toBe(m.db);
    } finally {
      vi.unstubAllEnvs();
      g.prisma = prevPrisma;
      vi.resetModules();
    }
  });
});
