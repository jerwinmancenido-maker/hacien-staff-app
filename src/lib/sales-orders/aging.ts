// SO aging: OPEN sales orders bucketed by days since the order date, using
// the same age bands as AR aging (src/lib/billing/aging.ts) so the two aging
// views read the same way. Read-only — no writes anywhere in this module.
//
// Scope rules:
// - Own-company documents only (businessId null), the same wall the tax and
//   Books surfaces apply: another business's orders never appear here.
// - An order ages only while money is still left to bill on it. Fully billed
//   orders move to AR aging (they are billed; collection is AR's job), and
//   VOID / CLOSED orders are out entirely.

import { db } from "../db";
import { money, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { AGING_BUCKETS, agingBucket, type AgingBucket } from "../billing/aging";
import { billingToday, calendarDaysBetween } from "../billing/dates";
import { remainingToBill } from "../billing/status";
import { pagingWindow, type ListPage } from "../paging";

export type SoAgingInputRow = {
  id: string;
  number: string;
  customerName: string;
  /** SO date (DATE column, stored as 00:00 UTC of that calendar day). */
  date: Date;
  status: string;
  contractPrice: string;
  /** Amounts of the SO's NON-VOID billings (the loader filters VOID out). */
  billedAmounts: readonly string[];
};

export type SoAgingRow = {
  id: string;
  number: string;
  customerName: string;
  /** SO date as YYYY-MM-DD. */
  date: string;
  daysOpen: number;
  bucket: AgingBucket;
  contractPrice: string;
  billed: string;
  leftToBill: string;
};

export type SoAgingBand = {
  bucket: AgingBucket;
  rows: SoAgingRow[];
  /**
   * Rows in the whole band. Equals rows.length in an unpaged summary;
   * pageSoAging slices rows for display but never narrows this count —
   * the band total line always speaks for the full band.
   */
  rowCount: number;
  /** Money sums across the band's rows. */
  contractPrice: string;
  billed: string;
  leftToBill: string;
};

export type SoAgingSummary = {
  /** Bands in AR aging order (current → 90+); bands with no rows are omitted. */
  bands: SoAgingBand[];
  orderCount: number;
  totalContractPrice: string;
  totalBilled: string;
  totalLeftToBill: string;
};

/**
 * Pure builder so unit tests pin the bucketing without a database.
 * The band edges come from agingBucket() — the same function AR aging uses —
 * fed with the SO date in place of a due date: days between the SO date and
 * today is the order's age. The AR government carve-out does not apply here
 * (it exists so government receivables never read as overdue; an old
 * government order still has unbilled work to age).
 */
export function buildSoAging(rows: readonly SoAgingInputRow[], today: Date = billingToday()): SoAgingSummary {
  const kept: SoAgingRow[] = [];
  for (const r of rows) {
    if (r.status !== "OPEN") continue;
    const leftToBill = remainingToBill(r.contractPrice, r.billedAmounts);
    if (toScaled(leftToBill, 2) <= 0n) continue;
    const billed = fromScaled(toScaled(r.contractPrice, 2) - toScaled(leftToBill, 2), 2);
    kept.push({
      id: r.id,
      number: r.number,
      customerName: r.customerName,
      date: ymd(r.date)!,
      daysOpen: calendarDaysBetween(r.date, today),
      bucket: agingBucket(r.date, today),
      contractPrice: r.contractPrice,
      billed,
      leftToBill,
    });
  }
  // Oldest first within a band — the longest-waiting orders get eyes first.
  kept.sort((a, b) => b.daysOpen - a.daysOpen || b.number.localeCompare(a.number));

  const bands: SoAgingBand[] = [];
  let totalContract = 0n;
  let totalBilled = 0n;
  let totalLeft = 0n;
  for (const bucket of AGING_BUCKETS) {
    const bandRows = kept.filter((r) => r.bucket === bucket);
    if (bandRows.length === 0) continue;
    let bandContract = 0n;
    let bandBilled = 0n;
    let bandLeft = 0n;
    for (const r of bandRows) {
      bandContract += toScaled(r.contractPrice, 2);
      bandBilled += toScaled(r.billed, 2);
      bandLeft += toScaled(r.leftToBill, 2);
    }
    totalContract += bandContract;
    totalBilled += bandBilled;
    totalLeft += bandLeft;
    bands.push({
      bucket,
      rows: bandRows,
      rowCount: bandRows.length,
      contractPrice: fromScaled(bandContract, 2),
      billed: fromScaled(bandBilled, 2),
      leftToBill: fromScaled(bandLeft, 2),
    });
  }
  return {
    bands,
    orderCount: kept.length,
    totalContractPrice: fromScaled(totalContract, 2),
    totalBilled: fromScaled(totalBilled, 2),
    totalLeftToBill: fromScaled(totalLeft, 2),
  };
}

export type SoAgingPage = ListPage<SoAgingRow> & {
  /**
   * The bands this page touches, in summary order, each with its rows
   * sliced to the page window. Band money totals and rowCount stay
   * whole-band — paging narrows only which rows render.
   */
  bands: SoAgingBand[];
};

/**
 * Slice-after-build paging for the aging page (finding 1040, mirroring
 * pageDispatchQueue): the summary is always built from the FULL open-orders
 * set, so the stat cards, band totals, and grand total are identical on
 * every page; only the rendered rows are windowed. The flattened row order
 * is the page's render order — bands in summary order, rows as built — so
 * the pages tile the full set exactly, with no gaps or overlaps.
 */
export function pageSoAging(summary: SoAgingSummary, page?: number, pageSize?: number): SoAgingPage {
  const win = pagingWindow(summary.orderCount, page, pageSize);
  const bands: SoAgingBand[] = [];
  let offset = 0;
  for (const band of summary.bands) {
    const from = Math.max(0, win.skip - offset);
    const to = Math.min(band.rows.length, win.skip + win.take - offset);
    if (to > from) bands.push({ ...band, rows: band.rows.slice(from, to) });
    offset += band.rows.length;
  }
  return {
    items: bands.flatMap((b) => b.rows),
    total: summary.orderCount,
    page: win.page,
    pageSize: win.pageSize,
    totalPages: win.totalPages,
    bands,
  };
}

/**
 * In-page search + band filter for the aging page (finding 1300 / proposal
 * P-B), mirroring the sales-orders list's ?q= search and filter chips.
 * Narrows a built summary to the orders whose SO number or customer name
 * contains the query (case-insensitive), optionally to one age band. The
 * returned summary is recomputed from the kept rows — band counts, band
 * totals, and the grand totals all speak for the filtered set — so the
 * page renders a filtered summary through the exact same path as an
 * unfiltered one. No query and no band returns the summary unchanged.
 */
export function filterSoAging(summary: SoAgingSummary, q?: string, band?: AgingBucket): SoAgingSummary {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle && !band) return summary;
  const matches = (r: SoAgingRow) =>
    (!band || r.bucket === band) &&
    (!needle || r.number.toLowerCase().includes(needle) || r.customerName.toLowerCase().includes(needle));
  const bands: SoAgingBand[] = [];
  let totalContract = 0n;
  let totalBilled = 0n;
  let totalLeft = 0n;
  let orderCount = 0;
  for (const b of summary.bands) {
    const rows = b.rows.filter(matches);
    if (rows.length === 0) continue;
    let bandContract = 0n;
    let bandBilled = 0n;
    let bandLeft = 0n;
    for (const r of rows) {
      bandContract += toScaled(r.contractPrice, 2);
      bandBilled += toScaled(r.billed, 2);
      bandLeft += toScaled(r.leftToBill, 2);
    }
    totalContract += bandContract;
    totalBilled += bandBilled;
    totalLeft += bandLeft;
    orderCount += rows.length;
    bands.push({
      bucket: b.bucket,
      rows,
      rowCount: rows.length,
      contractPrice: fromScaled(bandContract, 2),
      billed: fromScaled(bandBilled, 2),
      leftToBill: fromScaled(bandLeft, 2),
    });
  }
  return {
    bands,
    orderCount,
    totalContractPrice: fromScaled(totalContract, 2),
    totalBilled: fromScaled(totalBilled, 2),
    totalLeftToBill: fromScaled(totalLeft, 2),
  };
}

/**
 * DB loader: OPEN, own-company sales orders with their non-void billings.
 *
 * Perf (finding 1040): the builder only ever sums the billing amounts
 * (remainingToBill), so instead of hydrating every billing row of every
 * order, one groupBy SUM does that work in SQL and the orders themselves
 * load through a lean select of just the fields the builder reads.
 * Amounts are Decimal(15,2), so the SQL sum is exact to the centavo and
 * the figures are unchanged.
 */
export async function listSalesOrderAging(today: Date = billingToday()): Promise<SoAgingSummary> {
  const [rows, billedSums] = await Promise.all([
    db.salesOrder.findMany({
      where: { status: "OPEN", businessId: null },
      select: {
        id: true,
        number: true,
        date: true,
        status: true,
        contractPrice: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    db.billing.groupBy({
      by: ["salesOrderId"],
      where: { status: { not: "VOID" }, salesOrder: { status: "OPEN", businessId: null } },
      _sum: { amount: true },
    }),
  ]);
  const billedBySo = new Map(billedSums.map((g) => [g.salesOrderId, g._sum.amount]));
  return buildSoAging(
    rows.map((r) => ({
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      date: r.date,
      status: r.status,
      contractPrice: money(r.contractPrice),
      billedAmounts: billedBySo.has(r.id) ? [money(billedBySo.get(r.id)!)] : [],
    })),
    today,
  );
}
