#!/usr/bin/env node
/**
 * Throwaway fake billings for Home concept-A screenshots (local DB only).
 *
 *   node scripts/home-a-seed-shots.mjs fill
 *   node scripts/home-a-seed-shots.mjs empty
 *   node scripts/home-a-seed-shots.mjs restore
 *
 * `empty` parks all non-void billings' invoice dates in year 1990 so the
 * 12-month chart is empty (reversible via `restore` / `fill`).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TAG = "home-sales-07-shot";
const PARK_NOTE = "home-a-parked-for-empty-shot";

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

async function restoreParked() {
  // notes stored as "PARK|<iso>|<original notes or empty>"
  const parked = await db.billing.findMany({
    where: { notes: { startsWith: "PARK|" } },
  });
  for (const b of parked) {
    const parts = String(b.notes || "").split("|");
    const iso = parts[1];
    const rest = parts.slice(2).join("|");
    if (!iso) continue;
    await db.billing.update({
      where: { id: b.id },
      data: {
        invoiceDate: new Date(iso),
        notes: rest === "" || rest === "null" ? null : rest,
      },
    });
  }
  console.log("restore: unparked", parked.length, "billings");
  return parked.length;
}

async function parkAllForEmpty() {
  await restoreParked();
  const open = await db.billing.findMany({
    where: { status: { not: "VOID" } },
    select: { id: true, invoiceDate: true, notes: true },
  });
  for (const b of open) {
    await db.billing.update({
      where: { id: b.id },
      data: {
        invoiceDate: new Date("1990-01-15T00:00:00.000Z"),
        notes: `PARK|${b.invoiceDate.toISOString()}|${b.notes ?? "null"}`,
      },
    });
  }
  console.log("empty: parked", open.length, "billings outside the chart window");
}

async function fill() {
  await restoreParked();

  const admin = await db.user.findFirst({ where: { email: "jerwin@example.com" } });
  if (!admin) throw new Error("Seed jerwin@example.com first");

  const so = await db.salesOrder.findFirst({
    where: { status: "OPEN" },
    include: { customer: true },
    orderBy: { createdAt: "asc" },
  });
  if (!so) throw new Error("Need a sample sales order from seed");

  const prior = await db.billing.findMany({ where: { notes: TAG, status: { not: "VOID" } } });
  for (const b of prior) {
    await db.billing.update({
      where: { id: b.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: "home-a reshot", updatedById: admin.id },
    });
  }

  const today = manilaYmd();
  const cur = today.slice(0, 7);
  const amounts = [120000, 95000, 140000, 80000, 110000, 160000, 90000, 130000, 175000, 100000, 145000, 274000];
  let invoiceNo = 890_000 + Math.floor(Math.random() * 10_000);

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

  console.log("fill: created 12-month shot billings for", so.customer.name, `(${PARK_NOTE} unused)`);
}

async function main() {
  const mode = process.argv[2] || "fill";
  if (mode === "empty") await parkAllForEmpty();
  else if (mode === "restore") await restoreParked();
  else await fill();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
