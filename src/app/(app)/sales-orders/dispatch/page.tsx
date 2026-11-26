import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { money } from "@/lib/documents/common";
import { filterDispatchQueue, listDispatchQueue, pageDispatchQueue } from "@/lib/sales-orders/dispatch";
import { parsePageParam } from "@/lib/paging";
import { ListPager } from "@/components/ListPager";
import { AGING_BUCKETS, AGING_BUCKET_LABELS, type AgingBucket } from "@/lib/billing/aging";
import { SearchIcon } from "@/components/Icons";
import { EmptyState, PageHeader } from "@/components/ui";

/** Quantities print whole when they are whole ("2 pc", not "2.00 pc") —
 * the same strip the packing list applies. */
const qtyText = (qty: string, unit: string) => `${money(qty).replace(/\.00$/, "")} ${unit}`;

type Search = { q?: string; band?: string; page?: string };

function href(s: Search, patch: Partial<Search>) {
  const merged: Search = { ...s, ...patch };
  // Only a patch that names the page keeps one.
  if (!("page" in patch)) delete merged.page;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const qs = p.toString();
  return `/sales-orders/dispatch${qs ? `?${qs}` : ""}`;
}

export default async function DispatchQueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission("view");
  const s = await searchParams;
  const summary = await listDispatchQueue();
  const bandFilter = AGING_BUCKETS.includes(s.band as AgingBucket) ? (s.band as AgingBucket) : undefined;
  const view = filterDispatchQueue(summary, s.q, bandFilter);
  const queuePage = pageDispatchQueue(view, parsePageParam(s.page));
  const oldest = view.rows[0];

  return (
    <>
      <PageHeader
        title="Dispatch queue"
        subtitle="Open sales orders with goods still to deliver, oldest first. Own-company orders only."
      />
      <div className="toolbar">
        <Link className="btn secondary" href="/sales-orders">
          ← All sales orders
        </Link>
        <form className="search-pill" action="/sales-orders/dispatch" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by SO number or customer
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search SO no. or customer" />
          {bandFilter && <input type="hidden" name="band" value={bandFilter} />}
        </form>
        <Link className={`filter-chip${!bandFilter ? " active" : ""}`} href={href(s, { band: undefined })}>
          All bands
        </Link>
        {AGING_BUCKETS.map((b) => (
          <Link key={b} className={`filter-chip${bandFilter === b ? " active" : ""}`} href={href(s, { band: b })}>
            {AGING_BUCKET_LABELS[b]}
          </Link>
        ))}
      </div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Orders to dispatch</div>
          <div className="value num">{view.orderCount}</div>
          <div className="foot">Oldest first</div>
        </div>
        <div className="card stat">
          <div className="label">Quantity still to deliver</div>
          <div className="value num">
            {view.totalByUnit.length > 0
              ? view.totalByUnit.map((p) => qtyText(p.qty, p.unit)).join(" · ")
              : "0"}
          </div>
          <div className="foot">
            Across {view.orderCount} open order{view.orderCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className={`card stat${oldest && oldest.daysOpen > 30 ? " stat-red" : ""}`}>
          <div className="label">Longest-waiting order</div>
          <div className="value num">
            {oldest ? (
              <>
                <Link className="link" href={`/sales-orders/${oldest.id}`}>{oldest.number}</Link>
                <span className="small faint"> · {oldest.daysOpen} day{oldest.daysOpen === 1 ? "" : "s"}</span>
              </>
            ) : "—"}
          </div>
          <div className="foot">{oldest ? oldest.customerName : "Nothing waiting"}</div>
        </div>
      </div>
      {summary.orderCount === 0 ? (
        <div className="card">
          <EmptyState title="Nothing to dispatch." line="Every open sales order is fully delivered." />
        </div>
      ) : view.orderCount === 0 ? (
        <div className="card">
          <EmptyState title="No matches" line="Try another number or customer, or clear the filter." />
        </div>
      ) : (
        queuePage.items.map((r) => (
          <div className="card" key={r.id} style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0 }}>
              <Link className="link" href={`/sales-orders/${r.id}`}>{r.number}</Link>
            </h2>
            <p className="small" style={{ marginTop: 0 }}>
              {r.customerName}
            </p>
            <p className="small faint" style={{ marginTop: 0 }}>
              Ordered {formatDate(new Date(`${r.date}T00:00:00.000Z`))} · {r.daysOpen} day{r.daysOpen === 1 ? "" : "s"} open
              {r.contactName ? ` · Contact: ${r.contactName}${r.contactPhone ? ` · ${r.contactPhone}` : ""}` : ""}
            </p>
            {r.deliveryAddress ? (
              <p className="small" style={{ marginTop: 0 }}>
                Deliver to: {r.deliveryAddress}
              </p>
            ) : null}
            <div className="table-wrap">
              <table className="list" aria-label={`Items still to deliver for ${r.number}`}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="col-phone-cap">{l.description}</td>
                      <td className="num strong">{qtyText(l.qtyRemaining, l.unit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="strong">Total qty remaining</td>
                    <td className="num strong">{r.unitsByUnit.map((p) => qtyText(p.qty, p.unit)).join(" · ")}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
      <ListPager
        page={queuePage.page}
        totalPages={queuePage.totalPages}
        total={queuePage.total}
        noun="sales orders"
        hrefFor={(target) => href(s, { page: target > 1 ? String(target) : undefined })}
        jumpAction="/sales-orders/dispatch"
      />
    </>
  );
}
