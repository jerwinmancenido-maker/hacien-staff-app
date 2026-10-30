import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { isCashEnabled } from "@/lib/cash/features";
import { formatDate, formatPeso } from "@/lib/format";
import { getCollectionView } from "@/lib/billing/views";
import { Activity } from "@/components/Activity";
import { BillingNav } from "@/components/billing/BillingNav";
import { CollectionStatusChip, MethodLabel, PRINTABLE_DISCLAIMER } from "@/components/billing/BillingParts";
import { VoidButton } from "@/components/purchasing/DocButtons";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader } from "@/components/ui";
import { voidCollectionAction } from "../../actions";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export default async function CollectionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: raw } = await searchParams;
  const tab = raw === "allocations" || raw === "attachments" ? raw : "overview";
  const c = await getCollectionView(id);
  if (!c) notFound();
  const canManage = can(user, "manage_billing");
  const cashOn = await isCashEnabled();
  const canVoid = canManage && c.status === "POSTED" && !c.withholdings.some((w) => w.status === "RECEIVED");

  return (
    <>
      <PageHeader
        title={
          <>
            {c.number}
            <CollectionStatusChip status={c.status} />
          </>
        }
        subtitle={`${c.customer.name} · ${PRINTABLE_DISCLAIMER}`}
        actions={
          <>
            <Link className="btn btn-secondary" href={`/print/collections/${id}`} target="_blank">
              Print / Save PDF
            </Link>
            {canVoid && (
              <VoidButton
                label="Void"
                docLabel={`collection ${c.number}`}
                body="Voiding reverses allocations and billing statuses."
                onVoid={voidCollectionAction.bind(null, id)}
              />
            )}
          </>
        }
      />
      <BillingNav active="collections" />
      {c.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {c.voidReason}
        </div>
      )}

      <div className="detail-grid">
        <div className="card">
          <dl className="kv kv-grid">
            <dt>Customer</dt>
            <dd>
              <Link href={`/customers/${c.customer.id}`}>{c.customer.name}</Link>
            </dd>
            <dt>Date</dt>
            <dd>{day(c.date)}</dd>
            <dt>Method</dt>
            <dd>
              <MethodLabel method={c.method} />
            </dd>
            <dt>Reference</dt>
            <dd>{c.reference ?? "—"}</dd>
            {c.method === "CHECK" && (
              <>
                <dt>Bank</dt>
                <dd>{c.checkBank ?? "—"}</dd>
                <dt>Check date</dt>
                <dd>{day(c.checkDate)}</dd>
              </>
            )}
            <dt>Receipt no.</dt>
            <dd>{c.receiptNo ?? "—"}</dd>
            <dt>Deposited to</dt>
            <dd>
              {c.cashAccount ? (
                cashOn ? (
                  <Link href={`/cash/accounts/${c.cashAccount.id}`}>{c.cashAccount.name}</Link>
                ) : (
                  c.cashAccount.name
                )
              ) : (
                <span className="faint">Not assigned</span>
              )}
            </dd>
            <dt>Amount received</dt>
            <dd className="num strong">{formatPeso(c.amountReceived)}</dd>
            <dt>Cash applied</dt>
            <dd className="num">{formatPeso(c.cashApplied)}</dd>
            <dt>Unapplied credit</dt>
            <dd className="num">{formatPeso(c.unappliedCredit)}</dd>
            {c.notes && (
              <>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{c.notes}</dd>
              </>
            )}
          </dl>
        </div>
        <Activity targets={[{ entityType: "Collection", ids: [c.id] }]} viewer={user} />
      </div>

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/billing/collections/${id}` },
          { key: "allocations", label: "Allocations", count: c.allocations.length, href: `/billing/collections/${id}?tab=allocations` },
          { key: "attachments", label: "Attachments", count: c.attachments.length, href: `/billing/collections/${id}?tab=attachments` },
        ]}
      />

      {tab === "overview" && (
        <div className="card">
          <p className="faint small">Advances before billing stay as credit until applied. Refunds are out of scope.</p>
        </div>
      )}

      {tab === "allocations" && (
        <div className="card">
          {c.allocations.length === 0 ? (
            <p className="faint">Fully unapplied — customer credit.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Billing</th>
                    <th>Booklet</th>
                    <th className="num">Cash</th>
                    <th className="num">2307</th>
                  </tr>
                </thead>
                <tbody>
                  {c.allocations.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/billing/billings/${a.billing.id}`}>{a.billing.number}</Link>
                      </td>
                      <td>#{a.billing.invoiceNo}</td>
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
          {c.attachments.length === 0 ? (
            <p className="faint">No attachments.</p>
          ) : (
            <ul className="plain-list">
              {c.attachments.map((a) => (
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
