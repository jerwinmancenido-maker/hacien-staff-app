#!/usr/bin/env node
/**
 * Throwaway fake billings for Home concept-A screenshots (local DB only).
 *
 *   ALLOW_SEED_SHOTS=1 node scripts/home-a-seed-shots.mjs fill
 *   ALLOW_SEED_SHOTS=1 node scripts/home-a-seed-shots.mjs empty
 *   ALLOW_SEED_SHOTS=1 node scripts/home-a-seed-shots.mjs restore
 *
 * Requires ALLOW_SEED_SHOTS=1 and a local DATABASE_URL host (see
 * scripts/lib/assert-local-db.mjs). `empty` voids every non-VOID billing
 * (reversible) so Owed / overdue / chart all clear.
 */
import { assertLocalSeedShotsOrExit } from "./lib/assert-local-db.mjs";
import { PrismaClient } from "@prisma/client";

assertLocalSeedShotsOrExit();

const db = new PrismaClient();
const TAG = "home-sales-07-shot";
const EMPTY_VOID_REASON = "home-a-empty-shot";
const EMPTY_PREFIX = "EMPTYVOID|";

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

async function restoreEmptyVoids() {
  const voided = await db.billing.findMany({
    where: {
      OR: [{ voidReason: EMPTY_VOID_REASON }, { notes: { startsWith: EMPTY_PREFIX } }],
    },
  });
  for (const b of voided) {
    const notes = String(b.notes || "");
    let prevStatus = "OPEN";
    let prevNotes = null;
    if (notes.startsWith(EMPTY_PREFIX)) {
      const parts = notes.slice(EMPTY_PREFIX.length).split("|");
      prevStatus = parts[0] || "OPEN";
      const rest = parts.slice(1).join("|");
      prevNotes = rest === "" || rest === "null" ? null : rest;
    }
    await db.billing.update({
      where: { id: b.id },
      data: {
        status: prevStatus === "VOID" ? "OPEN" : prevStatus,
        voidedAt: null,
        voidReason: null,
        notes: prevNotes,
      },
    });
  }
  console.log("restore: un-voided", voided.length, "empty-shot billings");
  return voided.length;
}

/** Legacy PARK| invoice-date parking from earlier empty seed — restore if present. */
async function restoreParked() {
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
  if (parked.length) console.log("restore: unparked", parked.length, "legacy parked billings");
  return parked.length;
}

async function emptyAllBillings() {
  await restoreEmptyVoids();
  await restoreParked();
  const admin = await db.user.findFirst({ where: { email: "jerwin@example.com" } });
  if (!admin) throw new Error("Seed jerwin@example.com first");

  const open = await db.billing.findMany({
    where: { status: { not: "VOID" } },
    select: { id: true, status: true, notes: true },
  });
  for (const b of open) {
    await db.billing.update({
      where: { id: b.id },
      data: {
        status: "VOID",
        voidedAt: new Date(),
        voidReason: EMPTY_VOID_REASON,
        notes: `${EMPTY_PREFIX}${b.status}|${b.notes ?? "null"}`,
        updatedById: admin.id,
      },
    });
  }
  console.log("empty: voided", open.length, "billings (Owed / overdue / chart all clear)");
}

async function fill() {
  await restoreEmptyVoids();
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

  await seedPipelineAndActivity(admin, so);
  console.log("fill: created 12-month shot billings for", so.customer.name);
}

/** Open quotes + unbilled SO for Pipeline, and ≥5 recent-activity audit rows. */
async function seedPipelineAndActivity(admin, sampleSo) {
  const PIPE = `${TAG}-pipeline`;
  // Tear down prior pipeline fixtures — SOs first (FK to quote), then quotes.
  const oldSos = await db.salesOrder.findMany({ where: { notes: PIPE }, select: { id: true } });
  for (const s of oldSos) {
    await db.salesOrderItem.deleteMany({ where: { salesOrderId: s.id } });
    await db.auditLog.deleteMany({ where: { entityType: "SalesOrder", entityId: s.id } });
    await db.salesOrder.delete({ where: { id: s.id } });
  }
  const oldQuotes = await db.quote.findMany({ where: { notes: PIPE }, select: { id: true } });
  for (const q of oldQuotes) {
    await db.quoteItem.deleteMany({ where: { quoteId: q.id } });
    await db.auditLog.deleteMany({ where: { entityType: "Quote", entityId: q.id } });
    await db.quote.delete({ where: { id: q.id } });
  }

  const settings = await db.settingsVersion.findFirst({ orderBy: { version: "desc" } });
  if (!settings) throw new Error("Need a settings version");
  const customer = await db.customer.findFirst({ where: { id: sampleSo.customerId } });
  if (!customer) throw new Error("Need sample customer");
  const year = Number(manilaYmd().slice(0, 4));
  const today = new Date(`${manilaYmd()}T00:00:00.000Z`);

  async function nextNumber(docType, prefix) {
    const series = await db.documentSeries.upsert({
      where: { docType_year: { docType, year } },
      create: { docType, year, prefix, nextNumber: 9000, padding: 4 },
      update: {},
    });
    const n = series.nextNumber;
    await db.documentSeries.update({
      where: { id: series.id },
      data: { nextNumber: n + 1 },
    });
    return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  }

  async function createQuote(status, amount, label) {
    const number = await nextNumber("QUOTE", "QT");
    const quote = await db.quote.create({
      data: {
        number,
        customerId: customer.id,
        date: today,
        validUntil: today,
        status,
        notes: PIPE,
        settingsVersionId: settings.id,
        withholding: [],
        contractPrice: amount,
        withholdingTotal: 0,
        netReceived: amount,
        supplierCost: 0,
        netMargin: amount,
        netMarginPct: 100,
        createdById: admin.id,
        updatedById: admin.id,
        items: {
          create: [
            {
              sortOrder: 1,
              description: label,
              kind: "GOODS",
              qty: 1,
              unit: "lot",
              supplierUnitCost: 0,
              unitPrice: amount,
              total: amount,
              supplierTotal: 0,
              margin: amount,
              withholdingRate: 0,
            },
          ],
        },
      },
    });
    await db.auditLog.create({
      data: {
        userId: admin.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "create",
        after: { number, status, shotTag: PIPE },
        at: new Date(Date.now() - Math.random() * 120_000),
      },
    });
    return quote;
  }

  // Two SENT quotes → open pipeline (plus any existing DRAFT from main seed).
  await createQuote("SENT", 180_000, "Pipeline open quote A");
  await createQuote("SENT", 225_000, "Pipeline open quote B");

  // WON quote + OPEN SO with no billings → unbilled pipeline amount.
  const won = await createQuote("WON", 320_000, "Pipeline won quote for unbilled SO");
  const soNumber = await nextNumber("SALES_ORDER", "SO");
  const pipeSo = await db.salesOrder.create({
    data: {
      number: soNumber,
      quoteId: won.id,
      customerId: customer.id,
      date: today,
      status: "OPEN",
      notes: PIPE,
      settingsVersionId: settings.id,
      withholding: [],
      contractPrice: 320_000,
      withholdingTotal: 0,
      netReceived: 320_000,
      supplierCost: 0,
      netMargin: 320_000,
      netMarginPct: 100,
      createdById: admin.id,
      updatedById: admin.id,
      items: {
        create: [
          {
            sortOrder: 1,
            description: "Pipeline unbilled SO line",
            kind: "GOODS",
            qty: 1,
            unit: "lot",
            supplierUnitCost: 0,
            unitPrice: 320_000,
            total: 320_000,
            supplierTotal: 0,
            margin: 320_000,
            withholdingRate: 0,
          },
        ],
      },
    },
  });
  await db.auditLog.create({
    data: {
      userId: admin.id,
      entityType: "SalesOrder",
      entityId: pipeSo.id,
      action: "create",
      after: { number: soNumber, status: "OPEN", shotTag: PIPE },
      at: new Date(Date.now() - 15_000),
    },
  });

  // Seed create audits + these new ones (≥5) so desktop Recent shows 5 rows.
  console.log("fill: pipeline fixtures — 2 SENT quotes, 1 unbilled OPEN SO, activity audits");
}

async function main() {
  const mode = process.argv[2] || "fill";
  if (mode === "empty") await emptyAllBillings();
  else if (mode === "restore") {
    await restoreEmptyVoids();
    await restoreParked();
  } else await fill();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
