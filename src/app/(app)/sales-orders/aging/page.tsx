import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDate, formatPeso } from "@/lib/format";
import { listSalesOrderAging, pageSoAging } from "@/lib/sales-orders/aging";
import { parsePageParam } from "@/lib/paging";
import { ListPager } from "@/components/ListPager";
import { AGING_BUCKET_LABELS } from "@/lib/billing/aging";
import { EmptyState, PageHeader } from "@/components/ui";

type Search = { page?: string };

function href(s: Search, patch: Partial<Search>) {
  const merged: Search = { ...s, ...patch };
  // Only a patch that names the page keeps one.
  if (!("page" in patch)) delete merged.page;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const qs = p.toString();
  return `/sales-orders/aging${qs ? `?${qs}` : ""}`;
}

export default async function SoAgingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission("view");
  const s = await searchParams;
  const summary = await listSalesOrderAging();
  const agingPage = pageSoAging(summary, parsePageParam(s.page));
  const oldestBand = summary.bands.find((b) => b.bucket === "d90_plus");

  return (
    <>
      <PageHeader
        title="Sales order aging"
        subtitle="Open sales orders by days since the order date, using Manila dates. Own-company orders only — fully billed orders sit in AR aging."
      />
      <div className="toolbar">
        <Link className="btn secondary" href="/sales-orders">
          ← All sales orders
        </Link>
      </div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Total left to bill</div>
          <div className="value num">{formatPeso(summary.totalLeftToBill)}</div>
          <div className="foot">
            {summary.orderCount} open order{summary.orderCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Orders left to bill</div>
          <div className="value num">{summary.orderCount}</div>
          <div className="foot">Fully billed orders sit in AR aging</div>
        </div>
        <div className={`card stat${oldestBand ? " stat-red" : ""}`}>
          <div className="label">Left to bill — 90+ days</div>
          <div className="value num">{formatPeso(oldestBand?.leftToBill ?? "0.00")}</div>
          <div className="foot">
            {oldestBand ? `${oldestBand.rowCount} order${oldestBand.rowCount === 1 ? "" : "s"} in this band` : "No orders in this band"}
          </div>
        </div>
      </div>
      {summary.orderCount === 0 ? (
        <div className="card">
          <EmptyState title="Nothing aging." line="Every open sales order is fully billed." />
        </div>
      ) : (
        agingPage.bands.map((band) => (
          <div className="card band-card" key={band.bucket} style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0 }}>
              {band.bucket === "current" ? "Current — opened today" : `${AGING_BUCKET_LABELS[band.bucket]} days open`}
            </h2>
            <div className="table-wrap">
              <table className="list aging-table" aria-label={`Sales orders open ${AGING_BUCKET_LABELS[band.bucket]} days`}>
                <thead>
                  <tr>
                    <th>SO no.</th>
                    <th className="col-phone-cap">Customer</th>
                    <th>Order date</th>
                    <th className="num">Days open</th>
                    <th className="num col-phone-hide col-tab-hide">Total</th>
                    <th className="num col-phone-hide col-tab-hide">Billed</th>
                    <th className="num">Left to bill</th>
                  </tr>
                </thead>
                <tbody>
                  {band.rows.map((r) => (
                    <tr key={r.id}>
                      <td data-col="number">
                        <Link className="link" href={`/sales-orders/${r.id}`}>{r.number}</Link>
                      </td>
                      <td className="cell-cap col-phone-cap" title={r.customerName}>{r.customerName}</td>
                      <td data-col="date">{formatDate(new Date(`${r.date}T00:00:00.000Z`))}</td>
                      <td className="num">{r.daysOpen}</td>
                      <td className="num col-phone-hide col-tab-hide">{formatPeso(r.contractPrice)}</td>
                      <td className="num col-phone-hide col-tab-hide">{formatPeso(r.billed)}</td>
                      <td className="num strong">{formatPeso(r.leftToBill)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="strong">
                      Band total — {band.rowCount} order{band.rowCount === 1 ? "" : "s"}
                    </td>
                    <td className="num strong col-phone-hide col-tab-hide">{formatPeso(band.contractPrice)}</td>
                    <td className="num strong col-phone-hide col-tab-hide">{formatPeso(band.billed)}</td>
                    <td className="num strong">{formatPeso(band.leftToBill)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
      {summary.orderCount > 0 && agingPage.bands.length > 1 && (
        <div className="card band-card">
          <div className="table-wrap">
            <table className="list" aria-label="SO aging grand total">
              <thead>
                <tr>
                  <th></th>
                  <th className="num col-phone-hide">Total</th>
                  <th className="num col-phone-hide col-tab-hide">Billed</th>
                  <th className="num">Left to bill</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="strong">Grand total — left to bill across {summary.orderCount} open order{summary.orderCount === 1 ? "" : "s"}</td>
                  <td className="num strong col-phone-hide">{formatPeso(summary.totalContractPrice)}</td>
                  <td className="num strong col-phone-hide col-tab-hide">{formatPeso(summary.totalBilled)}</td>
                  <td className="num strong">{formatPeso(summary.totalLeftToBill)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ListPager
        page={agingPage.page}
        totalPages={agingPage.totalPages}
        total={agingPage.total}
        noun="sales orders"
        hrefFor={(target) => href(s, { page: target > 1 ? String(target) : undefined })}
        jumpAction="/sales-orders/aging"
      />
    </>
  );
}
