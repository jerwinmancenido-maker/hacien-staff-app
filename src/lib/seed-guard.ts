// Guard for prisma/seed.mts: fake sample data only on purpose, never in production.

export function seedRefusal(env: { NODE_ENV?: string; SEED_SAMPLE?: string }): string | null {
  if (env.NODE_ENV === "production") {
    return "Refusing to load sample data: NODE_ENV is production. Sample customers, suppliers and users are fake.";
  }
  if (env.SEED_SAMPLE !== "true") {
    return "Refusing to load sample data: set SEED_SAMPLE=true to confirm (e.g. `SEED_SAMPLE=true npm run db:seed`).";
  }
  return null;
}
