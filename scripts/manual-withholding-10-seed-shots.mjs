#!/usr/bin/env node
/**
 * Throwaway local seed for manual-withholding-10 screenshots.
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
const bcrypt = require("bcryptjs");
const db = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD || process.env.GUARD_PASSWORD || "TestPass123!";
  const hash = await bcrypt.hash(password, 12);
  await db.user.updateMany({
    where: { email: { in: ["jerwin@example.com", "staff@example.com", "viewer@example.com"] } },
    data: { passwordHash: hash },
  });

  // Prefer a GOVERNMENT customer; fall back to any customer.
  let customer =
    (await db.customer.findFirst({ where: { withholdingType: "GOVERNMENT", active: true } })) ||
    (await db.customer.findFirst({ where: { active: true } }));
  if (!customer) {
    console.error("No customer found. Run SEED_SAMPLE=true npm run db:seed first.");
    process.exit(1);
  }

  // Saved pick: Goods 1% + Gov PT 3% (combined rates for the gap demo).
  const pick = ["GOODS_1", "GOV_PT_3"];
  customer = await db.customer.update({
    where: { id: customer.id },
    data: {
      withholdingType: "GOVERNMENT",
      defaultWithholding: pick,
    },
  });

  let draft = await db.quote.findFirst({
    where: { status: "DRAFT", number: { startsWith: "QT-" } },
    orderBy: { createdAt: "desc" },
    include: { items: { where: { removedAt: null } } },
  });
  if (!draft) {
    console.error("No draft quote found. Run SEED_SAMPLE=true npm run db:seed first.");
    process.exit(1);
  }

  // Point draft at the government customer and copy the pick (does not rewrite money —
  // staff must re-apply / save in UI for line rates; screenshots show the pick UI).
  draft = await db.quote.update({
    where: { id: draft.id },
    data: {
      customerId: customer.id,
      withholdingPick: pick,
      notes: "Customer note for print: delivery to ICT office after PO.",
      internalNotes: "INTERNAL ONLY — withholding estimate stays in the editor, never on print.",
      subject: "Supply of laptops, printers and setup for the ICT office",
      buyerPoNo: "RFQ-2026-118",
    },
  });

  // A second customer with pick still null → "not set" notice on a fresh quote path.
  const notSet =
    (await db.customer.findFirst({
      where: { id: { not: customer.id }, active: true },
    })) || null;
  if (notSet) {
    await db.customer.update({
      where: { id: notSet.id },
      data: { defaultWithholding: null },
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      host: gate.host,
      customerId: customer.id,
      customerName: customer.name,
      quoteId: draft.id,
      quoteNumber: draft.number,
      pick,
      notSetCustomerId: notSet?.id ?? null,
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
