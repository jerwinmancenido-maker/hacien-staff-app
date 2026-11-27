// Sweep: open, still-unbilled quotes and sales orders whose saved withholding
// pick carries exactly ONE rate code ("single-code pick").
//
// Why: owner decision 2026-11-27 — withholding is 6% on everything (1% + 5%).
// The new standard pick (the stack GOV_GOODS_1 + GOV_SERVICES_1 + GOV_VAT_5)
// only reaches NEW documents through the customer default. Existing documents
// keep their saved pick by design (snapshots are never rewritten), so any open
// unbilled document still carrying a single-code pick would bill at the old
// per-type rate unless staff re-pick it on the edit screen first. This script
// produces that re-pick list. Run it at ship time against the target database
// and hand the list to staff; it changes nothing (read-only).
//
// Usage: DATABASE_URL=... node scripts/sweep-withholding-picks.mjs
// (falls back to ./.env.local when DATABASE_URL is not set)

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  for (const ln of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = ln.match(/^DATABASE_URL=(.*)$/);
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^"|"$/g, "");
  }
}

const db = new PrismaClient();

const snapshotCodes = (json) =>
  Array.isArray(json)
    ? json.filter((x) => x && typeof x === "object" && typeof x.code === "string").map((x) => x.code)
    : [];
const quotePickCodes = (q) =>
  Array.isArray(q.withholdingPick) ? q.withholdingPick.filter((v) => typeof v === "string") : snapshotCodes(q.withholding);
const peso = (d) => `PHP ${Number(d).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

try {
  // --- Sales orders: OPEN with no non-VOID billing -------------------------
  const allSos = await db.salesOrder.findMany({ orderBy: { number: "asc" } });
  const billedSoIds = new Set(
    (await db.billing.findMany({ where: { status: { not: "VOID" } }, select: { salesOrderId: true } })).map(
      (b) => b.salesOrderId,
    ),
  );
  const openUnbilledSos = allSos.filter((so) => so.status === "OPEN" && !billedSoIds.has(so.id));

  // --- Quotes: DRAFT / SENT / WON and not converted to an SO ---------------
  const convertedQuoteIds = new Set(allSos.map((so) => so.quoteId).filter(Boolean));
  const openQuotes = (await db.quote.findMany({ orderBy: { number: "asc" } })).filter(
    (q) => ["DRAFT", "SENT", "WON"].includes(q.status) && !convertedQuoteIds.has(q.id),
  );

  const customerIds = [...new Set([...openUnbilledSos.map((s) => s.customerId), ...openQuotes.map((q) => q.customerId)])];
  const customers = await db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } });
  const nameOf = (id) => customers.find((c) => c.id === id)?.name ?? id;

  const singleCode = [];
  let stackCount = 0;
  let otherCount = 0;
  const classify = (codes) => {
    if (codes.length === 1) return "single";
    if (codes.length >= 3) return "stack";
    return "other";
  };

  for (const so of openUnbilledSos) {
    const codes = snapshotCodes(so.withholding);
    const cls = classify(codes);
    if (cls === "single") singleCode.push(`SO  ${so.number} | ${nameOf(so.customerId)} | pick: ${codes[0]} | contract ${peso(so.contractPrice)}`);
    else if (cls === "stack") stackCount++;
    else otherCount++;
  }
  for (const q of openQuotes) {
    const codes = quotePickCodes(q);
    const cls = classify(codes);
    if (cls === "single") singleCode.push(`QT  ${q.number} | ${nameOf(q.customerId)} | pick: ${codes[0]} | contract ${peso(q.contractPrice)}`);
    else if (cls === "stack") stackCount++;
    else otherCount++;
  }

  console.log("Withholding sweep — open unbilled documents with a saved SINGLE-CODE pick");
  console.log("(these bill at the old per-type rate unless staff re-pick before billing)");
  console.log("--------------------------------------------------------------------------");
  for (const line of singleCode) console.log(line);
  if (singleCode.length === 0) console.log("(none)");
  console.log("--------------------------------------------------------------------------");
  console.log(
    `Scanned ${openUnbilledSos.length} open unbilled SOs + ${openQuotes.length} open unconverted quotes: ` +
      `${singleCode.length} single-code (action list above), ${stackCount} already on a 3+ code stack, ${otherCount} other (none / not set / two-code).`,
  );
} finally {
  await db.$disconnect();
}
