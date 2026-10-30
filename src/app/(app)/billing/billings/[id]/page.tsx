import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { getBillingView } from "@/lib/billing/views";
import { Activity } from "@/components/Activity";
import { ApplyCreditForm } from "@/components/billing/ApplyCreditForm";
import { BillingNav } from "@/components/billing/BillingNav";
import { BillingStatusChip, MethodLabel, OverdueBadge, PRINTABLE_DISCLAIMER } from "@/components/billing/BillingParts";
import { VoidButton } from "@/components/purchasing/DocButtons";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader } from "@/components/ui";
import { customerCreditBalance } from "@/lib/services/collections";
import { voidBillingAction } from "../../actions";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export default async function BillingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: raw } = await searchParams;
  const tab = raw === "allocations" || raw === "attachments" || raw === "activity" ? raw : "overview";
  const b = await getBillingView(id);
  if (!b) notFound();
  const canManage = can(user, "manage_billing");
  const canVoid = canManage && b.status !== "VOID" && b.allocations.length === 0;
  const credit =
    canManage && b.status !== "VOID" ? await customerCreditBalance(b.customer.id) : "0.00";

  return (
    <>
      <PageHeader
        title={
          <>
            Booklet #{b.invoiceNo}
            <BillingStatusChip status={b.status} />
            <OverdueBadge label={b.overdue.label} />
          </>
        }
        subtitle={`${b.number} · ${b.customer.name} · ${PRINTABLE_DISCLAIMER}`}
        actions={
          canVoid && (
            <VoidButton
              label="Void"
              docLabel={`billing ${b.number} (booklet #${b.invoiceNo})`}
              body="The booklet invoice number stays used and will never be reused."
              onVoid={voidBillingAction.bind(null, id)}
            />
          )
        }
      />
      <BillingNav active="billings" />

      {b.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {b.voidReason}
        </div>
      )}

      <div className="detail-grid">
        <div className="card">
          <dl className="kv kv-grid">
            <dt>Customer</dt>
            <dd>
              <Link href={`/customers/${b.customer.id}`}>{b.customer.name}</Link>
            </dd>
            <dt>Sales order</dt>
            <dd>
              <Link href={`/sales-orders/${b.salesOrder.id}`}>{b.salesOrder.number}</Link>
            </dd>
            <dt>Booklet invoice no.</dt>
            <dd className="num strong">{b.invoiceNo}</dd>
            <dt>Invoice date</dt>
            <dd>{day(b.invoiceDate)}</dd>
            <dt>Due date</dt>
            <dd>
              {day(b.dueDate)} <OverdueBadge label={b.overdue.label} />
            </dd>
            <dt>Amount</dt>
            <dd className="num">{formatPeso(b.amount)}</dd>
            <dt>Withholding expected</dt>
            <dd className="num">{formatPeso(b.withholdingExpected)}</dd>
            <dt>Net expected</dt>
            <dd className="num">{formatPeso(b.netExpected)}</dd>
            <dt>Cash applied</dt>
            <dd className="num">{formatPeso(b.applied.cashApplied)}</dd>
            <dt>2307 applied</dt>
            <dd className="num">{formatPeso(b.applied.withholdingApplied)}</dd>
            <dt>Balance</dt>
            <dd className="num strong">{formatPeso(b.balance)}</dd>
            {b.notes && (
              <>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{b.notes}</dd>
              </>
            )}
          </dl>
        </div>
        <Activity targets={[{ entityType: "Billing", ids: [b.id] }]} viewer={user} />
      </div>

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/billing/billings/${id}` },
          { key: "allocations", label: "Collections", count: b.allocations.length, href: `/billing/billings/${id}?tab=allocations` },
          { key: "attachments", label: "Attachments", count: b.attachments.length, href: `/billing/billings/${id}?tab=attachments` },
        ]}
      />

      {tab === "overview" && (
        <div className="card">
          <p className="faint small">{PRINTABLE_DISCLAIMER}. Internal ref {b.number}.</p>
          {b.withholdings.length > 0 && (
            <>
              <h2>2307s</h2>
              <ul className="plain-list">
                {b.withholdings.map((w) => (
                  <li key={w.id}>
                    <Link href="/billing/2307">{formatPeso(w.amount)}</Link> · {w.status}
                    {w.atcCode ? ` · ATC ${w.atcCode}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          {canManage && b.status !== "VOID" && (
            <ApplyCreditForm
              customerId={b.customer.id}
              availableCredit={credit}
              lockedBillingId={b.id}
              billings={[{ id: b.id, label: `Booklet #${b.invoiceNo}`, balance: b.balance }]}
            />
          )}
        </div>
      )}

      {tab === "allocations" && (
        <div className="card">
          {b.allocations.length === 0 ? (
            <p className="faint">No collections applied yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Collection</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Receipt</th>
                    <th className="num">Cash</th>
                    <th className="num">2307</th>
                  </tr>
                </thead>
                <tbody>
                  {b.allocations.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/billing/collections/${a.collection.id}`}>{a.collection.number}</Link>
                      </td>
                      <td>{day(a.collection.date)}</td>
                      <td>
                        <MethodLabel method={a.collection.method} />
                      </td>
                      <td>{a.collection.receiptNo ?? "—"}</td>
                      <td className="num">{formatPeso(a.cashApplied)}</td>
                      <td className="num">{formatPeso(a.withholdingApplied)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "attachments" && (
        <div className="card">
          {b.attachments.length === 0 ? (
            <p className="faint">No scans attached.</p>
          ) : (
            <ul className="plain-list">
              {b.attachments.map((a) => (
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
