import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { listApprovalInbox, type ApprovalPoRow, type ApprovalQuoteRow } from "@/lib/approvals/views";
import { formatDate, formatPeso } from "@/lib/format";
import { canSeeCosts } from "@/lib/permissions";
import { EmptyState, PageHeader } from "@/components/ui";
import { PoApprovalButton, QuoteApprovalButtons } from "@/components/approvals/InboxActions";
import { approvePoFromInboxAction, approveQuoteFromInboxAction, rejectQuoteFromInboxAction } from "./actions";

/**
 * Approval inbox (ERP adoption item 1): every quote and supplier PO
 * waiting for approval in one list. Only users with the "approve"
 * permission reach this page (requirePagePermission sends the rest to
 * /no-access, the app's existing pattern); PO rows additionally need
 * cost access, exactly like the PO pages themselves.
 */
export default async function ApprovalsPage() {
  const user = await requirePagePermission("approve");
  const inbox = await listApprovalInbox(user);
  const withCosts = canSeeCosts(user);

  const quoteRow = (r: ApprovalQuoteRow) => (
    <tr key={r.id}>
      <td>
        <Link href={`/quotes/${r.id}`}>{r.number}</Link>
        {r.businessName && <div className="small faint">{r.businessName}</div>}
      </td>
      <td>{r.customerName}</td>
      <td className="num">{formatPeso(r.total)}</td>
      <td>{formatDate(new Date(`${r.date}T00:00:00.000Z`))}</td>
      <td>
        {r.reasons.length > 0 ? (
          r.reasons.join(" · ")
        ) : r.reasonsHidden ? (
          <span className="faint">Needs approval — a cost reason is hidden from your view.</span>
        ) : (
          <span className="faint">Waiting for approval.</span>
        )}
      </td>
      <td>{r.createdByName}</td>
      <td>
        <QuoteApprovalButtons
          id={r.id}
          number={r.number}
          approve={approveQuoteFromInboxAction}
          reject={rejectQuoteFromInboxAction}
        />
      </td>
    </tr>
  );

  const poRow = (r: ApprovalPoRow) => (
    <tr key={r.id}>
      <td>
        <Link href={`/purchase-orders/${r.id}`}>{r.number}</Link>
        {r.businessName && <div className="small faint">{r.businessName}</div>}
      </td>
      <td>{r.supplierName}</td>
      <td className="num">{formatPeso(r.total)}</td>
      <td>{formatDate(new Date(`${r.date}T00:00:00.000Z`))}</td>
      <td>{r.createdByName}</td>
      <td>
        {r.blockedReason ? (
          <span className="small faint">{r.blockedReason}</span>
        ) : (
          <PoApprovalButton id={r.id} approve={approvePoFromInboxAction} />
        )}
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Everything waiting for an Approver or Admin, in one place. Approving or rejecting here is the same action as on the record itself — the approver and time are recorded the same way."
      />
      {inbox.total === 0 ? (
        <EmptyState title="Nothing waiting" line="No quotes or supplier POs are waiting for approval right now." />
      ) : (
        <>
          <h2>Quotes — {inbox.quotes.length} waiting</h2>
          {inbox.quotes.length === 0 ? (
            <p className="faint">No quotes are waiting for approval.</p>
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Quotes waiting for approval">
                <thead>
                  <tr>
                    <th>Quote</th>
                    <th>Customer</th>
                    <th className="num">Total</th>
                    <th>Date</th>
                    <th>Why it needs approval</th>
                    <th>Sent by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>{inbox.quotes.map(quoteRow)}</tbody>
              </table>
            </div>
          )}
          {withCosts && (
            <>
              <h2>Supplier POs — {inbox.purchaseOrders.length} waiting</h2>
              {inbox.purchaseOrders.length === 0 ? (
                <p className="faint">No supplier POs are waiting for approval.</p>
              ) : (
                <div className="table-wrap">
                  <table className="list" aria-label="Supplier POs waiting for approval">
                    <thead>
                      <tr>
                        <th>PO</th>
                        <th>Supplier</th>
                        <th className="num">Total</th>
                        <th>Date</th>
                        <th>Sent by</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>{inbox.purchaseOrders.map(poRow)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
