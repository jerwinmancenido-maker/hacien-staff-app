import Link from "next/link";
import type { StoreOrderStatus } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDateTime, formatPeso } from "@/lib/format";
import { listStoreOrders, STORE_ORDER_STATUS_LABELS, storeOrderDisplayLabel } from "@/lib/store-orders/views";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { ListPager } from "@/components/ListPager";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(STORE_ORDER_STATUS_LABELS) as StoreOrderStatus[];

/**
 * Store Orders inbox (store intake Slice 1): paid web orders waiting for a
 * staff conversion click (Slice 2). Read-only here — the flags on each row
 * (unmapped lines, unmatched buyer) are what staff resolve at conversion.
 */
export default async function StoreOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requirePagePermission("view");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as StoreOrderStatus) ? (sp.status as StoreOrderStatus) : null;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const { rows, total, totalPages } = await listStoreOrders({ status, page });

  const hrefFor = (p: number) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/store-orders?${s}` : "/store-orders";
  };
  const chipHref = (s: StoreOrderStatus | null) => (s ? `/store-orders?status=${s}` : "/store-orders");

  return (
    <>
      <PageHeader title="Store Orders" subtitle="Paid web orders, waiting for conversion into sales orders." />
      <div className="toolbar" role="group" aria-label="Filter by status">
        <Link className={`filter-chip${!status ? " active" : ""}`} href={chipHref(null)}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} className={`filter-chip${status === s ? " active" : ""}`} href={chipHref(s)}>
            {STORE_ORDER_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No store orders"
          line={status ? "No orders with this status yet." : "Paid web orders will appear here as the website sends them."}
        />
      ) : (
        <div className="table-wrap">
          <table className="list" aria-label="Store orders">
            <thead>
              <tr>
                <th>Order</th>
                <th>Buyer</th>
                <th>Gateway</th>
                <th className="num">Lines</th>
                <th className="num">Amount paid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/store-orders/${r.id}`}>{r.number}</Link>
                    <div className="small faint">Paid {formatDateTime(r.paidAt)}</div>
                  </td>
                  <td>
                    {r.buyerName}
                    <div className="small faint">
                      {r.matchedCustomerName ? `Match proposed: ${r.matchedCustomerName}` : "No customer match proposed"}
                    </div>
                  </td>
                  <td>{r.gatewayName}</td>
                  <td className="num">
                    {r.lineCount}
                    {r.unmappedCount > 0 ? (
                      <div>
                        <Chip tone="amber">{r.unmappedCount} unmapped</Chip>
                      </div>
                    ) : null}
                  </td>
                  <td className="num">{formatPeso(r.amountPaid)}</td>
                  <td>
                    <Chip tone={r.displayStatus === "PAID" ? "amber" : r.displayStatus === "DONE" ? "green" : "grey"}>
                      {storeOrderDisplayLabel(r.displayStatus)}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ListPager page={page} totalPages={totalPages} total={total} noun="store orders" hrefFor={hrefFor} jumpAction="/store-orders" jumpParams={{ status: status ?? "" }} />
    </>
  );
}
