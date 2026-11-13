import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canDeleteDocument } from "@/lib/permissions";
import { Chip } from "@/components/ui";
import { formatDate, formatPeso } from "@/lib/format";
import { ratePctLabel } from "@/lib/quotes/calc";
import { getBillingView } from "@/lib/billing/views";
import { billingDeleteBlocked } from "@/lib/services/document-delete";
import { Activity } from "@/components/Activity";
import { ApplyCreditForm } from "@/components/billing/ApplyCreditForm";
import { BillingNav } from "@/components/billing/BillingNav";
import { BillingStatusChip, MethodLabel, OverdueBadge, PRINTABLE_DISCLAIMER } from "@/components/billing/BillingParts";
import { DeleteButton, VoidButton } from "@/components/purchasing/DocButtons";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader } from "@/components/ui";
import { customerCreditBalance } from "@/lib/services/collections";
import { deleteBillingAction, markBillingCheckedAction, updateBillingExpectedDateFormAction, voidBillingAction } from "../../actions";

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
  const canVoid = canManage && b.status !== "VOID" && b.allocations.length === 0 && b.creditApplications.length === 0;
  const credit =
    canManage && b.status !== "VOID" ? await customerCreditBalance(b.customer.id) : "0.00";
  // A void billing the server would refuse to delete (allocations, 2307,
  // attachments incl. archived, credit applications) is kept for BIR
  // records — show the note, not a Delete button that only refuses.
  const deleteBlocked =
    canDeleteDocument(user) && b.status === "VOID" ? await billingDeleteBlocked(id) : false;

  return (
    <>
      <PageHeader
        title={
          <>
            Booklet #{b.invoiceNo}
            <BillingStatusChip status={b.status} />
            {b.needsAdminCheck && b.status !== "VOID" && <Chip tone="dark">Needs Admin check</Chip>}
            {!b.isGovernment && <OverdueBadge label={b.overdue.label} />}
          </>
        }
        subtitle={`${b.number} · ${b.customer.name} · ${PRINTABLE_DISCLAIMER}`}
        actions={
          <>
            <Link className="btn btn-secondary" href={`/print/billings/${id}`} target="_blank">
              Print / Save PDF
            </Link>
            {canManage && b.status !== "VOID" && (
              <Link className="btn btn-secondary" href={`/billing/billings/${id}/edit`}>
                Edit billing
              </Link>
            )}
            {user.isAdmin && b.needsAdminCheck && b.status !== "VOID" && (
              <form action={markBillingCheckedAction.bind(null, id)}>
                <button className="btn" type="submit">
                  Mark checked
                </button>
              </form>
            )}
            {canVoid && (
              <VoidButton
                label="Void"
                docLabel={`billing ${b.number} (booklet #${b.invoiceNo})`}
                body="The booklet invoice number stays used and will never be reused."
                onVoid={voidBillingAction.bind(null, id)}
              />
            )}
            {canDeleteDocument(user) && b.status === "VOID" && !deleteBlocked && (
              <DeleteButton
                number={b.number}
                body={`${b.number} (SI no. ${b.invoiceNo}) will be deleted. This cannot be undone, and its number will not be reused.`}
                onDelete={deleteBillingAction.bind(null, id)}
              />
            )}
            {canDeleteDocument(user) && b.status === "VOID" && deleteBlocked && (
              <span className="small muted">Kept for BIR records</span>
            )}
          </>
        }
      />
      <BillingNav active="billings" />

      {b.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {b.voidReason}
        </div>
      )}

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
          {b.expectedPaymentLabel ? (
            <>
              <dt>Expected by</dt>
              <dd>
                <span className="strong">{b.expectedPaymentLabel}</span>
                {can(user, "edit_data") && b.status !== "VOID" && (
                  <details style={{ marginTop: "4px" }}>
                    <summary className="small muted" style={{ cursor: "pointer" }}>Change Expected by date</summary>
                    <form action={updateBillingExpectedDateFormAction.bind(null, b.id)} style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" }}>
                      <input type="date" name="expectedDate" defaultValue={b.expectedDate ?? ""} className="input" style={{ width: "auto" }} />
                      <button type="submit" className="btn btn-secondary">Save</button>
                    </form>
                  </details>
                )}
              </dd>
            </>
          ) : (
            <>
              <dt>Due date</dt>
              <dd>
                {day(b.dueDate)} {!b.isGovernment && <OverdueBadge label={b.overdue.label} />}
              </dd>
            </>
          )}
          <dt>Amount</dt>
          <dd className="num">
            {formatPeso(b.amount)}
            {b.billingCoverage && (
              <div className="small muted">
                {b.billingCoverage.note}
                {b.billingCoverage.position ? ` ${b.billingCoverage.position}` : ""}
              </div>
            )}
          </dd>
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

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/billing/billings/${id}` },
          {key: "allocations", label: "Allocations", count: b.allocations.length + b.creditApplications.length, href: `/billing/billings/${id}?tab=allocations`},
          { key: "activity", label: "Activity", href: `/billing/billings/${id}?tab=activity` },
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
                    {w.lines.length > 0 ? (
                      <ul className="plain-list" style={{ marginTop: 4 }}>
                        {w.lines.map((l) => (
                          <li key={l.id} className="small">
                            {formatPeso(l.amount)}
                            {l.atcCode ? ` · ATC ${l.atcCode}` : ""}
                            {l.rate ? ` · ${ratePctLabel(Number(l.rate).toFixed(4))}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : w.atcCode ? (
                      ` · ATC ${w.atcCode}`
                    ) : (
                      ""
                    )}
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
          {b.allocations.length === 0 && b.creditApplications.length === 0 ? (
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
                  {b.creditApplications.map((a) => (
                    <tr key={a.id}>
                      <td>Credit memo {a.creditMemo}</td>
                      <td>{day(a.creditMemoDate)}</td>
                      <td>Return credit</td>
                      <td>—</td>
                      <td className="num">{formatPeso(a.cashApplied)}</td>
                      <td className="num">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <Activity targets={[{ entityType: "Billing", ids: [b.id] }]} viewer={user} />
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
