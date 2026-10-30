import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { isCashEnabled } from "@/lib/cash/features";
import { formatDate, formatPeso } from "@/lib/format";
import { getSupplierPaymentView } from "@/lib/payables/views";
import { Activity } from "@/components/Activity";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { PAYABLES_DISCLAIMER, PaymentMethodLabel, PaymentStatusChip, Supplier2307StatusChip } from "@/components/payables/PayablesParts";
import { VoidButton } from "@/components/purchasing/DocButtons";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader } from "@/components/ui";
import { voidSupplierPaymentAction } from "../../actions";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export default async function PaymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: raw } = await searchParams;
  const tab = raw === "allocations" || raw === "attachments" || raw === "2307" ? raw : "overview";
  const p = await getSupplierPaymentView(id);
  if (!p) notFound();
  const canManage = can(user, "manage_payables");
  const cashOn = await isCashEnabled();
  const canVoid = canManage && p.status === "POSTED" && !p.withholdings.some((w) => w.status === "ISSUED");

  return (
    <>
      <PageHeader
        title={
          <>
            {p.number}
            <PaymentStatusChip status={p.status} />
          </>
        }
        subtitle={`${p.supplier.name} · ${PAYABLES_DISCLAIMER}`}
        actions={
          <>
            <Link className="btn btn-secondary" href={`/print/supplier-payments/${id}`} target="_blank">
              Print / Save PDF
            </Link>
            {canVoid && (
              <VoidButton
                label="Void payment"
                docLabel={`payment ${p.number}`}
                body="This undoes the payment: bill balances go back up. Give a short reason. The payment number stays used and is never reused."
                onVoid={voidSupplierPaymentAction.bind(null, id)}
              />
            )}
          </>
        }
      />
      <PayablesNav active="payments" />
      {p.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {p.voidReason}
        </div>
      )}

      <div className="detail-grid">
        <div className="card">
          <dl className="kv kv-grid">
            <dt>Supplier</dt>
            <dd>
              <Link href={`/suppliers/${p.supplier.id}`}>{p.supplier.name}</Link>
            </dd>
            <dt>Date</dt>
            <dd>{day(p.date)}</dd>
            <dt>Method</dt>
            <dd>
              <PaymentMethodLabel method={p.method} />
            </dd>
            <dt>Reference</dt>
            <dd>{p.reference ?? "—"}</dd>
            {p.method === "CHECK" && (
              <>
                <dt>Bank</dt>
                <dd>{p.checkBank ?? "—"}</dd>
                <dt>Check date</dt>
                <dd>{day(p.checkDate)}</dd>
              </>
            )}
            <dt>Paid from</dt>
            <dd>
              {p.cashAccount ? (
                cashOn ? (
                  <Link href={`/cash/accounts/${p.cashAccount.id}`}>{p.cashAccount.name}</Link>
                ) : (
                  p.cashAccount.name
                )
              ) : (
                <span className="faint">Not assigned</span>
              )}
            </dd>
            <dt>Cash paid</dt>
            <dd className="num strong">{formatPeso(p.amountPaid)}</dd>
            <dt>Applied to bills</dt>
            <dd className="num">{formatPeso(p.cashApplied)}</dd>
            <dt>
              Withholding total
              <div className="hint">EWT — expanded withholding tax, if any</div>
            </dt>
            <dd className="num">{formatPeso(p.withholdingTotal)}</dd>
            {p.notes && (
              <>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{p.notes}</dd>
              </>
            )}
          </dl>
        </div>
        <Activity targets={[{ entityType: "SupplierPayment", ids: [p.id] }]} viewer={user} />
      </div>

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/payables/payments/${id}` },
          { key: "allocations", label: "Allocations", count: p.allocations.length, href: `/payables/payments/${id}?tab=allocations` },
          { key: "2307", label: "2307", count: p.withholdings.filter((w) => Number(w.amount) > 0).length, href: `/payables/payments/${id}?tab=2307` },
          { key: "attachments", label: "Attachments", count: p.attachments.length, href: `/payables/payments/${id}?tab=attachments` },
        ]}
      />

      {tab === "overview" && (
        <div className="card">
          <p className="faint small">
            This is a record of a bank payment already made — the app does not send money. Status and amounts are at the top; use the tabs for bill breakdown and attachments.
          </p>
          {p.allocations.length > 0 && (
            <p className="small" style={{ marginTop: 12 }}>
              Applied to{" "}
              {p.allocations.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  {a.supplierBill.purchaseOrderId ? (
                    <Link href={`/purchase-orders/${a.supplierBill.purchaseOrderId}?tab=bills`}>{a.supplierBill.billNumber}</Link>
                  ) : (
                    a.supplierBill.billNumber
                  )}
                </span>
              ))}
              {" · "}
              <Link href={`/suppliers/${p.supplier.id}?tab=payments`}>Supplier payments</Link>
            </p>
          )}
        </div>
      )}

      {tab === "allocations" && (
        <div className="card">
          {p.allocations.length === 0 ? (
            <p className="faint">No allocations.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Supplier bill</th>
                    <th className="num">Cash</th>
                    <th className="num">Withheld (EWT)</th>
                    <th className="num">Rate</th>
                    <th>ATC code</th>
                  </tr>
                </thead>
                <tbody>
                  {p.allocations.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.supplierBill.purchaseOrderId ? (
                          <Link href={`/purchase-orders/${a.supplierBill.purchaseOrderId}?tab=bills`}>{a.supplierBill.billNumber}</Link>
                        ) : (
                          a.supplierBill.billNumber
                        )}
                        <div className="faint small">Due {day(a.supplierBill.dueDate)}</div>
                      </td>
                      <td className="num">{formatPeso(a.cashApplied)}</td>
                      <td className="num">{formatPeso(a.withholdingApplied)}</td>
                      <td className="num">{(Number(a.withholdingRate) * 100).toFixed(2)}%</td>
                      <td>{a.atcCode ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="faint small" style={{ marginTop: 12 }}>
            Cash on each row must add up to cash paid. Withholding (EWT) reduces what is still owed on the bill but is not part of cash paid.
          </p>
        </div>
      )}

      {tab === "2307" && (
        <div className="card">
          {p.withholdings.filter((w) => Number(w.amount) > 0).length === 0 ? (
            <p className="faint">No 2307 to issue on this payment.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Rate</th>
                    <th>ATC</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.withholdings
                    .filter((w) => Number(w.amount) > 0)
                    .map((w) => (
                      <tr key={w.id}>
                        <td className="num">{formatPeso(w.amount)}</td>
                        <td>{(Number(w.rate) * 100).toFixed(2)}%</td>
                        <td>{w.atcCode ?? "—"}</td>
                        <td>
                          <Supplier2307StatusChip status={w.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="faint small" style={{ marginTop: 12 }}>
            Status only — the app does not generate BIR Form 2307.
          </p>
        </div>
      )}

      {tab === "attachments" && (
        <div className="card">
          {p.attachments.length === 0 ? (
            <p className="faint">No proof-of-payment attachments.</p>
          ) : (
            <ul className="plain-list">
              {p.attachments.map((a) => (
                <li key={a.id}>
                  <a href={a.href}>{a.fileName}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
