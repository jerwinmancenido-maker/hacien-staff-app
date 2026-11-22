import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDate, formatPeso } from "@/lib/format";
import { listSalesOrderAging } from "@/lib/sales-orders/aging";
import { AGING_BUCKET_LABELS } from "@/lib/billing/aging";
import { PageHeader } from "@/components/ui";

export default async function SoAgingPage() {
  await requirePagePermission("view");
  const summary = await listSalesOrderAging();
  const oldestBand = summary.bands.find((b) => b.bucket === "d90_plus");

  return (
    <>
      <PageHeader
        title="Sales order aging"
        subtitle="Open sales orders by days since the order date (Manila). Own-company orders only — fully billed orders sit in AR aging."
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
        </div>
        <div className="card stat">
          <div className="label">Open orders</div>
          <div className="value num">{summary.orderCount}</div>
        </div>
        <div className={`card stat${oldestBand ? " stat-red" : ""}`}>
          <div className="label">Left to bill — 90+ days</div>
          <div className="value num">{formatPeso(oldestBand?.leftToBill ?? "0.00")}</div>
        </div>
      </div>
      {summary.orderCount === 0 ? (
        <div className="card">
          <p className="faint" style={{ margin: 0 }}>
            Nothing aging. Every open sales order is fully billed.
          </p>
        </div>
      ) : (
        summary.bands.map((band) => (
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
                    <th className="num col-phone-hide">Total</th>
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
                      <td className="num col-phone-hide">{formatPeso(r.contractPrice)}</td>
                      <td className="num col-phone-hide col-tab-hide">{formatPeso(r.billed)}</td>
                      <td className="num strong">{formatPeso(r.leftToBill)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="strong">
                      Band total — {band.rows.length} order{band.rows.length === 1 ? "" : "s"}
                    </td>
                    <td className="num strong col-phone-hide">{formatPeso(band.contractPrice)}</td>
                    <td className="num strong col-phone-hide col-tab-hide">{formatPeso(band.billed)}</td>
                    <td className="num strong">{formatPeso(band.leftToBill)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
      {summary.orderCount > 0 && (
        <div className="card band-card">
          <div className="table-wrap">
            <table className="list" aria-label="SO aging grand total">
              <tbody>
                <tr>
                  <td className="strong">Grand total — left to bill across {summary.orderCount} open order{summary.orderCount === 1 ? "" : "s"}</td>
                  <td className="num strong">{formatPeso(summary.totalContractPrice)}</td>
                  <td className="num strong">{formatPeso(summary.totalBilled)}</td>
                  <td className="num strong">{formatPeso(summary.totalLeftToBill)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
