import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getQuoteView } from "@/lib/quotes/views";
import { OVERRIDE_NOTE } from "@/lib/quotes/withholding-defaults";
import { listAddresses, suggestedDeliveryAddress } from "@/lib/services/addresses";
import { formatAddress } from "@/lib/addresses/format";
import { ADDRESS_KIND_LABELS } from "@/lib/validation/addresses";
import { formatDate, formatDateTime } from "@/lib/format";
import { Activity } from "@/components/Activity";
import { Chip, PageHeader } from "@/components/ui";
import { ApprovalChip, ItemsTable, QuoteStatusChip, QuoteWorkflowApprovalChip, SoStatusChip, TotalsBox } from "@/components/docs/DocParts";
import { QuoteActions } from "@/components/docs/QuoteActions";
import {
  approveQuoteAction,
  confirmNoneAndMarkQuoteSentAction,
  convertQuoteAction,
  emailDraftAction,
  markQuoteLostAction,
  markQuoteSentAction,
  refreshQuoteCompanyDetailsAction,
  rejectQuoteAction,
  voidQuoteAction,
} from "../actions";
import { WITHHOLDING_INTERNAL_PANEL_LABEL, WITHHOLDING_NOT_SET_NOTICE, isWithholdingNotSet } from "@/lib/quotes/withholding-defaults";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
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
            canApproveWorkflow={q.canApproveWorkflow}
            openSalesOrderId={openSo?.id ?? null}
            customerAddress={suggestedAddress}
            addressOptions={addressOptions}
            withholdingNotSet={isWithholdingNotSet(q.withholdingPick)}
            actions={{
              markSent: markQuoteSentAction,
              confirmNoneAndMarkSent: confirmNoneAndMarkQuoteSentAction,
              markLost: markQuoteLostAction,
              void: voidQuoteAction,
              convert: convertQuoteAction,
              email: emailDraftAction,
              refreshCompanyDetails: refreshQuoteCompanyDetailsAction,
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
          Low margin / over threshold: {q.approval.reasons.join(" · ")}.
        </div>
      )}
      <div className="detail-grid">
        <div>
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
          {q.salesOrders.length > 0 && (
            <div className="card">
              <h2>Sales orders from this quote</h2>
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
            </div>
          )}
          <div className="small faint">
            Created by {q.createdBy} · last updated by {q.updatedBy}, {formatDateTime(q.updatedAt)}
          </div>
        </div>
        <Activity targets={[{ entityType: "Quote", ids: [q.id] }]} viewer={user} />
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
    </>
  );
}
