import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canVoid } from "@/lib/permissions";
import { getQuoteView } from "@/lib/quotes/views";
import { COST_NOT_SET_LABEL, linesMissingSupplierCost } from "@/lib/quotes/calc";
import { OVERRIDE_NOTE } from "@/lib/quotes/withholding-defaults";
import { listAddresses, suggestedDeliveryAddress } from "@/lib/services/addresses";
import { formatAddress } from "@/lib/addresses/format";
import { ADDRESS_KIND_LABELS } from "@/lib/validation/addresses";
import { formatDate, formatDateTime } from "@/lib/format";
import { Activity } from "@/components/Activity";
import { PillTabs } from "@/components/PillTabs";
import { Chip, PageHeader } from "@/components/ui";
import { ApprovalChip, ItemsTable, QuoteStatusChip, QuoteWorkflowApprovalChip, SoStatusChip, TotalsBox } from "@/components/docs/DocParts";
import { QuoteActions } from "@/components/docs/QuoteActions";
import { ConformeUploadForm } from "@/components/docs/ConformeUploadForm";
import { AcceptanceForm } from "@/components/docs/AcceptanceForm";
import { RemindMeForm } from "@/components/RemindMeForm";
import { createReminderAction } from "@/app/(app)/reminders/actions";
import {
  uploadQuoteConformeAction,
  recordQuoteAcceptanceAction,
  approveQuoteAction,
  confirmNoneAndMarkQuoteSentAction,
  convertQuoteAction,
  duplicateQuoteAction,
  emailDraftAction,
  markQuoteLostAction,
  markQuoteSentAction,
  newRevisionQuoteAction,
  refreshQuoteCompanyDetailsAction,
  rejectQuoteAction,
  voidQuoteAction,
} from "../actions";
import { WITHHOLDING_INTERNAL_PANEL_LABEL, WITHHOLDING_NOT_SET_NOTICE, isWithholdingNotSet } from "@/lib/quotes/withholding-defaults";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: raw } = await searchParams;
  const tab = raw === "sales-orders" || raw === "conforme" || raw === "activity" ? raw : "overview";
  // Built on the server without cost fields for users who can't see costs.
  const q = await getQuoteView(id, user);
  if (!q) notFound();
  const canEdit = can(user, "edit_data");
  const openSo = q.salesOrders.find((s) => s.status === "OPEN");
  // Convert to SO: pick one of the customer's saved addresses (delivery first) or type one.
  const editable = canEdit && (q.status === "DRAFT" || q.status === "SENT");
  const saved = editable ? await listAddresses({ kind: "customer", id: q.customer.id }) : [];
  const addressOptions = [...saved]
    .sort((a, b) => Number(b.kind === "DELIVERY") - Number(a.kind === "DELIVERY"))
    .map((a) => ({
      id: a.id,
      label: `${ADDRESS_KIND_LABELS[a.kind]}${a.label ? ` · ${a.label}` : ""}${a.isDefault ? " (default)" : ""}: ${formatAddress(a)}`,
      text: formatAddress(a, { multiline: true }),
    }));
  const suggestedAddress = editable ? ((await suggestedDeliveryAddress(q.customer)) ?? "") : "";

  return (
    <>
      <PageHeader
        title={
          <>
            {q.number}
            <Chip>Rev {q.revision}</Chip>
            <QuoteStatusChip status={q.status} />
            {q.status !== "VOID" && (
              <QuoteWorkflowApprovalChip status={q.approvalStatus} label={q.approvalLabel} />
            )}
            {q.status !== "VOID" && (
              <ApprovalChip approval={q.approval} workflowApproved={q.approvalStatus === "APPROVED"} />
            )}
          </>
        }
        subtitle={`${q.customer.name}${q.contact ? ` · ${q.contact.name}` : ""} · Valid until ${day(q.validUntil)}`}
        actions={
          <QuoteActions
            id={q.id}
            number={q.number}
            status={q.status}
            approvalStatus={q.approvalStatus}
            canEdit={canEdit}
            canVoid={canVoid(user)}
            canApproveWorkflow={q.canApproveWorkflow}
            openSalesOrderId={openSo?.id ?? null}
            customerAddress={suggestedAddress}
            addressOptions={addressOptions}
            withholdingNotSet={isWithholdingNotSet(q.withholdingPick)}
            costMissing={q.canSeeCosts && linesMissingSupplierCost(q.items)}
            hasAcceptance={q.hasAcceptance}
            actions={{
              markSent: markQuoteSentAction,
              confirmNoneAndMarkSent: confirmNoneAndMarkQuoteSentAction,
              markLost: markQuoteLostAction,
              void: voidQuoteAction,
              convert: convertQuoteAction,
              email: emailDraftAction,
              refreshCompanyDetails: refreshQuoteCompanyDetailsAction,
              duplicate: duplicateQuoteAction,
              newRevision: newRevisionQuoteAction,
              approve: approveQuoteAction,
              reject: rejectQuoteAction,
            }}
          />
        }
      />
      {q.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {q.voidReason} This quote is read-only.
        </div>
      )}
      {q.approvalStatus === "APPROVED" && q.approvedBy && q.approvedAt && (
        <div className="alert" role="status">
          Approved by {q.approvedBy} · {formatDateTime(q.approvedAt)}
        </div>
      )}
      {q.approvalStatus === "REJECTED" && (
        <div className="alert error" role="status">
          Rejected by {q.rejectedBy ?? "Approver"}
          {q.rejectedAt ? ` · ${formatDateTime(q.rejectedAt)}` : ""}
          {q.rejectReason ? `: ${q.rejectReason}` : ""}
        </div>
      )}
      {q.approvalStatus === "PENDING" && q.status !== "VOID" && (
        <div className="alert warn" role="status">
          Waiting for approval. Mark as sent, Email and Convert to SO stay unavailable until an Approver or Admin approves.
        </div>
      )}
      {isWithholdingNotSet(q.withholdingPick) && q.status === "DRAFT" && (
        <div className="alert wh-not-set" role="status">
          {WITHHOLDING_NOT_SET_NOTICE}
        </div>
      )}
      {q.approvalStatus !== "APPROVED" && q.approval.needed && q.approval.reasons && q.status !== "VOID" && (
        <div className="alert warn" role="status">
          {q.approval.reasons.includes(COST_NOT_SET_LABEL)
            ? q.approval.reasons.join(" · ")
            : `Low margin / over threshold: ${q.approval.reasons.join(" · ")}.`}
        </div>
      )}

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/quotes/${id}` },
          { key: "sales-orders", label: "Sales orders", count: q.salesOrders.length, href: `/quotes/${id}?tab=sales-orders` },
          { key: "conforme", label: "Conforme", count: q.conformeFiles.length, href: `/quotes/${id}?tab=conforme` },
          { key: "activity", label: "Activity", href: `/quotes/${id}?tab=activity` },
        ]}
      />

      {tab === "overview" && (
        <>
          <p className="small muted">
            Sales orders: {q.salesOrders.length} · <Link href={`/quotes/${id}?tab=sales-orders`}>View →</Link>
            {" · "}Conforme: {q.acceptedAt ? "accepted" : q.conformeFiles.length === 0 ? "missing" : "uploaded"} · <Link href={`/quotes/${id}?tab=conforme`}>View →</Link>
          </p>
          <div className="card">
            <dl className="kv kv-grid">
              <dt>Customer</dt>
              <dd>
                <Link href={`/customers/${q.customer.id}`}>{q.customer.name}</Link>
              </dd>
              <dt>Contact</dt>
              <dd>{q.contact ? `${q.contact.name}${q.contact.email ? ` · ${q.contact.email}` : ""}` : "—"}</dd>
              <dt>Date</dt>
              <dd>{day(q.date)}</dd>
              <dt>Valid until</dt>
              <dd>{day(q.validUntil)}</dd>
              <dt>Terms</dt>
              <dd>{q.terms ?? "—"}</dd>
              {q.subject && (
                <>
                  <dt>Subject / project</dt>
                  <dd>{q.subject}</dd>
                </>
              )}
              {q.buyerPoNo && (
                <>
                  <dt>Customer PO / RFQ no.</dt>
                  <dd>{q.buyerPoNo}</dd>
                </>
              )}
              <dt>Withholding</dt>
              <dd>
                {q.withholdingPick == null
                  ? "not set"
                  : q.withholdingPick.length === 0
                    ? "none"
                    : q.withholding.length
                      ? q.withholding.map((w) => w.label).join(", ")
                      : "none"}
                <div className="small faint">Internal estimate — not on the printed quote</div>
              </dd>
              {q.notes && (
                <>
                  <dt>Notes on quote</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{q.notes}</dd>
                </>
              )}
              {q.internalNotes && (
                <>
                  <dt>Internal notes</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>
                    <span className="small muted">Internal only, never prints</span>
                    <div>{q.internalNotes}</div>
                  </dd>
                </>
              )}
            </dl>
          </div>
          <div className="small faint">
            Created by {q.createdBy} · last updated by {q.updatedBy}, {formatDateTime(q.updatedAt)}
          </div>
          <div className="card">
            <h2>Items</h2>
            <ItemsTable
              items={q.items.map((i) => ({
                ...i,
                overrideNote: i.withholdingOverride ? OVERRIDE_NOTE : null,
              }))}
              showCosts={q.canSeeCosts}
            />
            <div className="totals-wrap">
              <div className="wh-internal-panel">
                <div className="wh-internal-panel-label">{WITHHOLDING_INTERNAL_PANEL_LABEL}</div>
                <TotalsBox totals={q.totals} showCosts={q.canSeeCosts} />
              </div>
            </div>
          </div>
          {canEdit && <RemindMeForm entityType="QUOTE" entityId={q.id} action={createReminderAction} />}
        </>
      )}

      {tab === "sales-orders" && (
        <div className="card">
          <h2>Sales orders from this quote</h2>
          {q.salesOrders.length === 0 ? (
            <p className="faint">No sales orders yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Sales orders from this quote">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Date</th>
                    <th>Buyer PO</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.salesOrders.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/sales-orders/${s.id}`}>{s.number}</Link>
                      </td>
                      <td>{day(s.date)}</td>
                      <td>{s.buyerPoNo ?? "—"}</td>
                      <td>
                        <SoStatusChip status={s.status} />
                        {s.status === "VOID" && s.voidReason && <div className="small muted">{s.voidReason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <Activity targets={[{ entityType: "Quote", ids: [q.id] }]} viewer={user} />
      )}

      {tab === "conforme" && (
        <>
          <div className="card">
            <h2>Signed conforme</h2>
            {q.conformeFiles.length === 0 ? (
              <p className="faint">No signed conforme uploaded yet. Conforme stays a blank line on the print until the customer signs.</p>
            ) : (
              <ul className="plain-list">
                {q.conformeFiles.map((f) => (
                  <li key={f.id}>
                    <a href={f.href}>{f.fileName}</a>
                  </li>
                ))}
              </ul>
            )}
            {canEdit && q.status !== "VOID" && <ConformeUploadForm action={uploadQuoteConformeAction.bind(null, q.id)} />}
          </div>
          <div className="card">
            <h2>Customer acceptance</h2>
            {q.acceptedAt ? (
              <p>
                Accepted by {q.acceptedBy} · {formatDate(q.acceptedAt)} · {q.acceptedViaLabel}
              </p>
            ) : (
              <>
                <p className="faint">
                  No acceptance recorded yet. Converting to a sales order needs one of: a signed conforme above, a buyer PO
                  number, or the record below.
                </p>
                {editable && <AcceptanceForm action={recordQuoteAcceptanceAction.bind(null, q.id)} />}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
