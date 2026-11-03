// Guard for prisma/seed.mts and prisma/seed-demo.mts:
// Base seed (settings, roles, withholding catalog, first Admin) is safe for live go-live.
// Demo business data (customers, quotes, suppliers, etc.) is strictly for staging.

export const DEMO_GUARD_MESSAGE = "Demo seed is for staging only. Set SEED_DEMO_STAGING=1 to run it.";

/**
 * Pure guard function for demo seed.
 * Demo runs ONLY when SEED_DEMO_STAGING=1 (exact).
 * Returns refusal message if not allowed, or null when allowed.
 */
export function demoSeedGuard(env: { SEED_DEMO_STAGING?: string; [key: string]: string | undefined }): string | null {
  if (env.SEED_DEMO_STAGING !== "1") {
    return DEMO_GUARD_MESSAGE;
  }
  return null;
}

export const demoGuard = demoSeedGuard;
export const demoSeedRefusal = demoSeedGuard;

/**
 * Checks whether demo seeding was requested via env vars or script arguments.
 */
export function isDemoRequested(env: {
  SEED_DEMO?: string;
  SEED_DEMO_STAGING?: string;
  SEED_SAMPLE?: string;
  [key: string]: string | undefined;
}): boolean {
  return env.SEED_DEMO === "1" || env.SEED_DEMO_STAGING !== undefined || env.SEED_SAMPLE === "true";
}

/** Legacy refusal function for backward compatibility. */
export function seedRefusal(env: { NODE_ENV?: string; SEED_SAMPLE?: string; SEED_DEMO_STAGING?: string }): string | null {
  if (env.SEED_DEMO_STAGING === "1") {
    return null;
  }
  if (env.NODE_ENV === "production") {
    return "Refusing to load sample data: NODE_ENV is production. Sample customers, suppliers and users are fake.";
  }
  if (env.SEED_SAMPLE !== "true") {
    return "Refusing to load sample data: set SEED_SAMPLE=true to confirm (e.g. `SEED_SAMPLE=true npm run db:seed`).";
  }
  return null;
}
