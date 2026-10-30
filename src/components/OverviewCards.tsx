// Stat cards shared by the customer and supplier overviews: open quotes / SOs
// (customer only) and business-document expiry. Supplier pages hide Open quotes
// and Open SOs — those belong on the customer overview.

import Link from "next/link";
import { formatPeso } from "@/lib/format";

export type DocCounts = { active: number; expired: number; expiring: number };
export type OpenDocStats = {
  openQuotes: number;
  openQuotesTotal: string;
  openSalesOrders: number;
  openSalesOrdersTotal: string;
  // Supplier overview, cost users only:
  openPos?: number;
  awaitingReceipt?: number;
} | null;

/** Which open-doc cards to show. Suppliers never get Open quotes / Open SOs. */
export function openDocCardIds(
  stats: OpenDocStats,
  showQuotesAndSos: boolean,
): Array<"restricted" | "openQuotes" | "openSalesOrders" | "openPos"> {
  if (!stats) return showQuotesAndSos ? ["restricted"] : [];
  const ids: Array<"openQuotes" | "openSalesOrders" | "openPos"> = [];
  if (showQuotesAndSos) {
    ids.push("openQuotes", "openSalesOrders");
  }
  if (stats.openPos !== undefined) ids.push("openPos");
  return ids;
}

export function OpenDocsCards({
  stats,
  basePath,
  showTotals,
  showQuotesAndSos = true,
}: {
  stats: OpenDocStats;
  basePath: string;
  showTotals: boolean;
  /** Customer overview only. Suppliers pass false. */
  showQuotesAndSos?: boolean;
}) {
  const cards = openDocCardIds(stats, showQuotesAndSos);
  if (cards.length === 0) return null;

  return (
    <>
      {cards.includes("restricted") && (
        <div className="card stat">
          <div className="label">Open quotes / SOs</div>
          <div className="value num faint">—</div>
          <div className="foot faint">Needs “Can see costs”</div>
        </div>
      )}
      {cards.includes("openQuotes") && stats && (
        <Link className="card stat stat-link" href={`${basePath}?tab=transactions&type=QUOTE`}>
          <div className="label">Open quotes</div>
          <div className="value num">{stats.openQuotes}</div>
          <div className="foot">{showTotals ? `${formatPeso(stats.openQuotesTotal)} · Draft + Sent` : "Draft + Sent"}</div>
        </Link>
      )}
      {cards.includes("openSalesOrders") && stats && (
        <Link className="card stat stat-link" href={`${basePath}?tab=transactions&type=SALES_ORDER&status=OPEN`}>
          <div className="label">Open SOs</div>
          <div className="value num">{stats.openSalesOrders}</div>
          <div className="foot">{showTotals ? formatPeso(stats.openSalesOrdersTotal) : "Open sales orders"}</div>
        </Link>
      )}
      {cards.includes("openPos") && stats && stats.openPos !== undefined && (
        <Link className="card stat stat-link" href={`${basePath}?tab=transactions&type=PURCHASE_ORDER`}>
          <div className="label">Open POs</div>
          <div className="value num">{stats.openPos}</div>
          <div className="foot">{stats.awaitingReceipt ?? 0} awaiting receipt</div>
        </Link>
      )}
    </>
  );
}

export function DocumentsCard({ counts, basePath, warnDays }: { counts: DocCounts; basePath: string; warnDays: number }) {
  const tone = counts.expired ? "red" : counts.expiring ? "amber" : undefined;
  return (
    <Link className={`card stat stat-link${tone ? ` stat-${tone}` : ""}`} href={`${basePath}?tab=documents`}>
      <div className="label">Documents</div>
      <div className="value num">{counts.active}</div>
      <div className="foot">
        {counts.expired || counts.expiring
          ? [counts.expired ? `${counts.expired} expired` : null, counts.expiring ? `${counts.expiring} expiring ≤ ${warnDays} d` : null].filter(Boolean).join(" · ")
          : counts.active
            ? "None expiring"
            : "None uploaded"}
      </div>
    </Link>
  );
}
