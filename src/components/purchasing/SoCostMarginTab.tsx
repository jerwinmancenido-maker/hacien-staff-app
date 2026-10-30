import Link from "next/link";
import { formatPeso } from "@/lib/format";
import type { CostMarginSummary } from "@/lib/purchasing/cost-margin";
import { PoStatusChip } from "./PoParts";

export function SoCostMarginTab({ summary }: { summary: CostMarginSummary }) {
  return (
    <div className="details-stack" aria-label="Cost and margin">
      {summary.warnings.length > 0 && (
        <div className="details-stack">
          {summary.warnings.map((w) => (
            <div key={w.code} className="alert warn" role="status">
              <b>{w.title}</b>
              <div className="small" style={{ marginTop: 4 }}>
                {w.hint}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Purchases for this order</h2>
          <div className="right small muted">
            {summary.rows.length} PO{summary.rows.length === 1 ? "" : "s"} · void documents excluded
          </div>
        </div>
        {summary.rows.length === 0 ? (
          <p className="faint">No supplier POs linked to this sales order yet.</p>
        ) : (
          <div className="table-wrap cost-margin-purchases">
            <table className="list" aria-label="Purchases for this order">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th className="num">PO total</th>
                  <th className="num">Received</th>
                  <th className="num">Billed</th>
                  <th className="num">Cost used</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <Link href={`/purchase-orders/${po.id}`}>{po.number}</Link>
                    </td>
                    <td>{po.supplierName}</td>
                    <td>
                      <PoStatusChip status={po.status} />
                    </td>
                    <td className="num">{formatPeso(po.poTotal)}</td>
                    <td className="num">{po.hasReceipts ? formatPeso(po.receivedValue) : "—"}</td>
                    <td className="num">{po.hasBills ? formatPeso(po.billedAmount) : "—"}</td>
                    <td className="num">
                      <span className="strong">{formatPeso(po.cost)}</span>
                      <div className="small muted">{po.basisLabel}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Cost &amp; margin</h2>
          <div className="right small muted">Cost basis: billed → received → PO total</div>
        </div>
        <dl className="kv kv-grid">
          <dt>SO contract total</dt>
          <dd className="num strong">{formatPeso(summary.contractPrice)}</dd>
          <dt>Cost so far</dt>
          <dd className="num strong">{formatPeso(summary.totalCost)}</dd>
          <dt>Actual margin</dt>
          <dd className="num">
            <span className="strong">{formatPeso(summary.actual.margin)}</span>
            <span className="muted"> ({summary.actual.marginPct}%)</span>
          </dd>
          <dt>Planned margin</dt>
          <dd className="num">
            {formatPeso(summary.planned.margin)}
            <span className="muted"> ({summary.planned.marginPct}%)</span>
            <div className="small faint">Contract − planned supplier cost (before withholding)</div>
          </dd>
        </dl>
      </div>
    </div>
  );
}
