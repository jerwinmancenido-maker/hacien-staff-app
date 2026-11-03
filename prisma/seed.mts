// Base database seed: settings defaults, withholding catalog, and initial Admin.
// Safe for production go-live (contains ZERO customer, supplier, quote, or SO business records).
//
// Staging demo data: runs demo business records ONLY when SEED_DEMO_STAGING=1 is set.
// Passwords: sample users get SEED_PASSWORD if set, otherwise a random one.
// Passwords are never printed — set SEED_PASSWORD or use "Forgot password".

import { PrismaClient } from "@prisma/client";
import { noDeleteExtension } from "../src/lib/no-delete.ts";
import { demoSeedGuard, isDemoRequested, seedRefusal } from "../src/lib/seed-guard.ts";
import { seedBase } from "../src/lib/seed-base.ts";
import { seedDemo } from "./seed-demo.mts";

export function connect() {
  return new PrismaClient().$extends(noDeleteExtension);
}

async function main() {
  const demoRequested = isDemoRequested(process.env);

  // If demo seeding is requested, enforce that it runs ONLY on staging with SEED_DEMO_STAGING=1.
  if (demoRequested) {
    const demoRefusal = demoSeedGuard(process.env);
    if (demoRefusal) {
      console.error(demoRefusal);
      process.exitCode = 1;
      return;
    }

    // Legacy refusal check for backwards compatibility
    const refusal = seedRefusal(process.env);
    if (refusal) {
      console.error(refusal);
      process.exitCode = 1;
      return;
    }
  }

  const db = connect();
  try {
    // 1. Always run the BASE seed (Settings defaults, withholding catalog, first Admin)
    await seedBase(db);

    // 2. Run demo business seed ONLY when the staging flag is set
    if (demoRequested) {
      await seedDemo(db);
    }

    console.log("Seed done.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
