#!/usr/bin/env node
/**
 * Throwaway local seed for Quote Phase 1 screenshots.
 * Requires ALLOW_SEED_SHOTS=1 and a localhost DATABASE_URL.
 * Never touches staging/live. Never prints secrets or real customer data.
 */
import { createRequire } from "node:module";
import { checkLocalSeedShots } from "./lib/assert-local-db.mjs";

const gate = checkLocalSeedShots(process.env);
if (!gate.ok) {
  console.error(gate.error);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function main() {
  const draft = await db.quote.findFirst({
    where: { status: "DRAFT", number: { startsWith: "QT-" } },
    orderBy: { createdAt: "desc" },
  });
  if (!draft) {
    console.error("No draft quote found. Run SEED_SAMPLE=true npm run db:seed first.");
    process.exit(1);
  }

  await db.quote.update({
    where: { id: draft.id },
    data: {
      notes: "Customer note for print: delivery to ICT office after PO.",
      internalNotes: "INTERNAL ONLY — supplier still confirming Epson lead time. Never print this.",
      subject: "Supply of laptops, printers and setup for the ICT office",
      buyerPoNo: "RFQ-2026-118",
    },
  });

  console.log(JSON.stringify({ ok: true, quoteId: draft.id, number: draft.number, host: gate.host }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
