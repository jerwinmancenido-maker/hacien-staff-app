import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatPeso } from "@/lib/format";
import { arAgingSummary, taxYearBillingMeter } from "@/lib/billing/views";
import { AGING_BUCKET_LABELS, AGING_BUCKETS } from "@/lib/billing/aging";
import { formatNonVatPctLabel } from "@/lib/services/non-vat";
import { BillingNav } from "@/components/billing/BillingNav";
import { PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

export default async function BillingHomePage() {
  const user = await requirePagePermission("view");
  const canManage = can(user, "manage_billing");
  const [summary, meter] = await Promise.all([arAgingSummary(), taxYearBillingMeter()]);

  return (
    <>
      <PageHeader
        title="Billing & Collections"
        subtitle="Record hand-written booklet invoices and collections. Nothing here is an official invoice or OR."
        actions={
          canManage && (
            <>
              <Link className="btn btn-secondary" href="/billing/collections/new">
                <PlusIcon /> Record collection
              </Link>
              <Link className="btn" href="/billing/billings/new">
                <PlusIcon /> Record billing
              </Link>
            </>
          )
        }
      />
      <BillingNav active="home" />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <Link className="card stat stat-link" href="/billing/aging">
          <div className="label">Total receivable</div>
          <div className="value num">{formatPeso(summary.totalReceivable)}</div>
          <div className="foot">Open billing balances</div>
        </Link>
        <Link className={`card stat stat-link${Number(summary.overdue) > 0 ? " stat-red" : ""}`} href="/billing/billings?status=OVERDUE">
          <div className="label">Overdue</div>
          <div className="value num">{formatPeso(summary.overdue)}</div>
          <div className="foot">Past due + {summary.graceDays} day grace</div>
        </Link>
        <Link className="card stat stat-link" href="/billing/2307?status=PENDING">
          <div className="label">2307 pending</div>
          <div className="value num">{summary.pending2307Count}</div>
          <div className="foot">
            {summary.pending2307Count === 1 ? "1 billing" : `${summary.pending2307Count} billings`} need a 2307
            {Number(summary.pending2307) > 0 ? ` · ${formatPeso(summary.pending2307)} recorded pending` : ""}
          </div>
        </Link>
        <Link className="card stat stat-link" href="/billing/collections">
          <div className="label">Customer credit</div>
          <div className="value num">{formatPeso(summary.credit)}</div>
          <div className="foot">Unapplied payments</div>
        </Link>
      </div>

      {can(user, "manage_settings") && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h2>Tax year {meter.year} (gross billings)</h2>
            <div className="right small muted">
              {formatPeso(meter.gross)} of {formatPeso(meter.limit)} non-VAT limit ({formatNonVatPctLabel(meter.pct)})
            </div>
          </div>
          <div className="aging-bar-track" aria-hidden>
            <div
              className={`aging-bar-fill${meter.pct >= meter.warnSecondPct ? " red" : meter.pct >= meter.warnFirstPct ? " amber" : ""}`}
              style={{ width: `${Math.min(100, meter.pct)}%` }}
            />
          </div>
          <div className="faint small" style={{ marginTop: 8 }}>
            Warnings at {meter.warnFirstPct}% and {meter.warnSecondPct}% of the non-VAT sales limit.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>AR by customer</h2>
          <div className="right">
            <Link className="btn-link small" href="/billing/aging">
              Full aging →
            </Link>
          </div>
        </div>
        {summary.byCustomer.length === 0 ? (
          <p className="faint">No open receivables yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="list" aria-label="AR by customer">
              <thead>
                <tr>
                  <th>Customer</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b} className="num">
                      {AGING_BUCKET_LABELS[b]}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {summary.byCustomer.slice(0, 15).map((r) => (
                  <tr key={r.customerId}>
                    <td>
                      <Link href={`/customers/${r.customerId}?tab=balances`}>{r.customerName}</Link>
                    </td>
                    {AGING_BUCKETS.map((b) => (
                      <td key={b} className="num">
                        {formatPeso(r.aging[b])}
                      </td>
                    ))}
                    <td className="num strong">{formatPeso(r.aging.total)}</td>
                    <td className="num">{formatPeso(r.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
