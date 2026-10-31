#!/usr/bin/env node
/**
 * Throwaway fake billings for Home Sales screenshots (local DB only).
 * Creates / refreshes a tagged set of non-void billings across the last 12
 * Manila months, then optionally voids them for the empty-state shots.
 *
 * Usage:
 *   ALLOW_SEED_SHOTS=1 node scripts/home-sales-07-seed-shots.mjs fill
 *   ALLOW_SEED_SHOTS=1 node scripts/home-sales-07-seed-shots.mjs empty
 *
 * Requires ALLOW_SEED_SHOTS=1 and a local DATABASE_URL host (see
 * scripts/lib/assert-local-db.mjs).
 */
import { assertLocalSeedShotsOrExit } from "./lib/assert-local-db.mjs";
import { PrismaClient } from "@prisma/client";

assertLocalSeedShotsOrExit();

const db = new PrismaClient();
const TAG = "home-sales-07-shot";

function manilaYmd(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shiftMonth(ymd, delta) {
  const [y, m] = ymd.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

async function main() {
  const mode = process.argv[2] || "fill";
  const admin = await db.user.findFirst({ where: { email: "jerwin@example.com" } });
  if (!admin) throw new Error("Seed jerwin@example.com first");

  const so = await db.salesOrder.findFirst({
    where: { status: "OPEN" },
    include: { customer: true },
    orderBy: { createdAt: "asc" },
  });
  if (!so) throw new Error("Need a sample sales order from seed");

  // Mark prior shot billings void so re-runs don't stack forever (no deletes).
  const prior = await db.billing.findMany({ where: { notes: TAG, status: { not: "VOID" } } });
  for (const b of prior) {
    await db.billing.update({
      where: { id: b.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: "home-sales-07 reshot", updatedById: admin.id },
    });
  }

  if (mode === "empty") {
    console.log("empty: voided", prior.length, "prior shot billings");
    await db.$disconnect();
    return;
  }

  const today = manilaYmd();
  const cur = today.slice(0, 7);
  const amounts = [120000, 95000, 140000, 80000, 110000, 160000, 90000, 130000, 175000, 100000, 145000, 210000];
  let invoiceNo = 880_000 + Math.floor(Math.random() * 10_000);

  // Ensure booklet is wide enough.
  const latest = await db.settingsVersion.findFirst({ orderBy: { version: "desc" } });
  if (latest) {
    const data = latest.data;
    const booklet = data.invoiceBooklet || {};
    if ((booklet.seriesTo ?? 500) < 9_999_999) {
      await db.settingsVersion.create({
        data: {
          version: latest.version + 1,
          data: { ...data, invoiceBooklet: { ...booklet, seriesFrom: 1, seriesTo: 9_999_999, label: "Shot booklet" } },
          changedKey: "invoiceBooklet",
          before: booklet,
          after: { seriesFrom: 1, seriesTo: 9_999_999, label: "Shot booklet" },
          createdById: admin.id,
        },
      });
    }
  }

  for (let i = 0; i < 12; i++) {
    const key = shiftMonth(cur, -(11 - i));
    const ymd = `${key}-15`;
    const amount = amounts[i];
    invoiceNo += 1;
    await db.billing.create({
      data: {
        number: `BL-SHOT-${TAG}-${invoiceNo}`,
        salesOrderId: so.id,
        customerId: so.customerId,
        invoiceNo,
        invoiceDate: new Date(`${ymd}T00:00:00.000Z`),
        dueDate: new Date(`${ymd}T00:00:00.000Z`),
        amount,
        withholdingExpected: 0,
        netExpected: amount,
        status: "OPEN",
        notes: TAG,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
  }

  // A couple more customers for top-3 variety.
  const others = await db.customer.findMany({ take: 3, orderBy: { createdAt: "asc" } });
  for (let i = 0; i < others.length; i++) {
    const c = others[i];
    const theirSo = await db.salesOrder.findFirst({ where: { customerId: c.id } });
    if (!theirSo) continue;
    invoiceNo += 1;
    const amt = [88000, 64000, 42000][i] ?? 30000;
    await db.billing.create({
      data: {
        number: `BL-SHOT-${TAG}-C${invoiceNo}`,
        salesOrderId: theirSo.id,
        customerId: c.id,
        invoiceNo,
        invoiceDate: new Date(`${cur}-10T00:00:00.000Z`),
        dueDate: new Date(`${cur}-10T00:00:00.000Z`),
        amount: amt,
        withholdingExpected: 0,
        netExpected: amt,
        status: "OPEN",
        notes: TAG,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
  }

  console.log("fill: created shot billings for", so.customer.name, "+ top customers");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
