// Document numbers: QT-2026-0001, SO-2026-0001 … One counter per document type
// per year (DocumentSeries), restarting each year unless the Numbering setting
// says otherwise (then year 0 holds a single running counter).
//
// allocateDocNumber() must run inside the transaction that creates the
// document: it locks the series row with SELECT … FOR UPDATE, so parallel
// creates queue up and get consecutive numbers, and a failed create rolls the
// counter back with it (no visible gap). Numbers are never reused: voiding
// keeps the number, and Quote/SalesOrder.number are unique.
//
// Only type imports here, so prisma/seed.mts can use this file directly.

import type { DocType } from "@prisma/client";
import type { Db, Tx } from "../db";

export type NumberFormat = { prefix: string; padding: number; resetYearly: boolean };

/** e.g. QT-2026-0001 */
export function formatDocNumber(format: Pick<NumberFormat, "prefix" | "padding">, year: number, counter: number): string {
  return `${format.prefix}-${year}-${String(counter).padStart(format.padding, "0")}`;
}

/** The DocumentSeries.year that holds the counter for a document dated in `year`. */
export function seriesYear(format: NumberFormat, year: number): number {
  return format.resetYearly ? year : 0;
}

type RawClient = Pick<Db | Tx, "$executeRaw" | "$queryRaw">;

function newId(): string {
  return `ser_${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Create the year's series row if it doesn't exist yet. Call it before opening
 * the document transaction (autocommit), so parallel first-of-the-year creates
 * don't deadlock on the insert. Creating the row doesn't use up a number.
 */
export async function ensureSeries(client: RawClient, docType: DocType, year: number, format: NumberFormat): Promise<void> {
  const y = seriesYear(format, year);
  await client.$executeRaw`INSERT IGNORE INTO \`DocumentSeries\` (\`id\`, \`docType\`, \`year\`, \`prefix\`, \`nextNumber\`, \`padding\`) VALUES (${newId()}, ${docType}, ${y}, ${format.prefix}, 1, ${format.padding})`;
}

/**
 * Take the next number for `docType` in `year`. Inside a transaction only.
 * The prefix and padding come from the current Numbering settings.
 */
export async function allocateDocNumber(tx: RawClient, docType: DocType, year: number, format: NumberFormat): Promise<string> {
  const y = seriesYear(format, year);
  const lock = () =>
    tx.$queryRaw<{ id: string; nextNumber: number }[]>`SELECT \`id\`, \`nextNumber\` FROM \`DocumentSeries\` WHERE \`docType\` = ${docType} AND \`year\` = ${y} FOR UPDATE`;
  let rows = await lock();
  if (!rows.length) {
    // ensureSeries() wasn't called first; create it here (still safe, just slower under contention).
    await ensureSeries(tx, docType, year, format);
    rows = await lock();
  }
  const row = rows[0];
  if (!row) throw new Error(`Could not open the ${docType} number series for ${year}.`);
  const n = Number(row.nextNumber);
  await tx.$executeRaw`UPDATE \`DocumentSeries\` SET \`nextNumber\` = ${n + 1}, \`prefix\` = ${format.prefix}, \`padding\` = ${format.padding} WHERE \`id\` = ${row.id}`;
  return formatDocNumber(format, year, n);
}
