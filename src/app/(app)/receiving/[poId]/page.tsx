import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts, canVoid } from "@/lib/permissions";
import { getReceivingView } from "@/lib/purchasing/views";
import { EmptyState, PageHeader } from "@/components/ui";
import { day, PoStatusChip, QtyBar, qtyText } from "@/components/purchasing/PoParts";
import { RrTable } from "@/components/purchasing/RrTable";
import { WarrantyClaimCreateForm, WarrantyClaimStatusForm } from "@/components/purchasing/WarrantyClaims";
import { isWarrantyClaimsEnabled } from "@/lib/purchasing/warranty-claims";
import { splitSerialNumbers, WARRANTY_CLAIM_STATUS_LABELS, type WarrantyClaimStatus } from "@/lib/purchasing/warranty-claims-shared";
import { voidReceivingReportAction } from "../actions";
import { changeWarrantyClaimStatusAction, createWarrantyClaimAction } from "../warranty-actions";

// Receiving view of a PO: quantities only (no unit costs, totals or amounts).
export default async function ReceivingPoPage({ params, searchParams }: { params: Promise<{ poId: string }>; searchParams: Promise<{ posted?: string }> }) {
  const user = await requirePagePermission("view");
  const { poId } = await params;
  const { posted } = await searchParams;
  const po = await getReceivingView(poId, user);
  if (!po) notFound();
  const canEdit = can(user, "edit_data");
  const claimsEnabled = await isWarrantyClaimsEnabled();

  return (
    <>
      <PageHeader
        title={
          <>
            {po.number}
            <PoStatusChip status={po.status} />
          </>
        }
        subtitle={`${po.supplier.name} · ${po.salesOrderNumber ? `For ${po.salesOrderNumber}` : "Standalone PO"} · Expected ${day(po.expectedDate)}`}
        actions={
          <>
            {canSeeCosts(user) && (
              <Link className="btn btn-secondary" href={`/purchase-orders/${po.id}`}>
                Open PO
              </Link>
            )}
            {canEdit && po.canReceive && (
              <Link className="btn" href={`/receiving/${po.id}/new`}>
                Receive items
              </Link>
            )}
          </>
        }
      />
      {posted && (
        <div className="alert ok" role="status">
          Receiving report posted.
        </div>
      )}
      <div className="card">
        <h2>Lines</h2>
        <div className="table-wrap">
          <table className="list" aria-label="PO lines">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th className="num">Remaining</th>
                <th aria-label="Progress" />
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "pre-wrap" }}>
                    {l.description}
                    {l.coverageNote && <div className="small muted">{l.coverageNote}</div>}
                  </td>
                  <td className="num">
                    {qtyText(l.orderedQty)} {l.unit}
                  </td>
                  <td className="num">{qtyText(l.receivedQty)}</td>
                  <td className="num strong">{qtyText(l.remainingQty)}</td>
                  <td style={{ minWidth: 90 }}>
                    <QtyBar received={l.receivedQty} ordered={l.orderedQty} label={`Received ${qtyText(l.receivedQty)} of ${qtyText(l.orderedQty)}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {po.deliveryAddressText && (
          <div className="small muted" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
            <b>Deliver to:</b> {po.deliveryAddressText}
          </div>
        )}
      </div>
      <div className="card">
        <h2>Receiving reports</h2>
        {po.receivingReports.length === 0 ? (
          <EmptyState line="Nothing received yet." />
        ) : (
          <RrTable reports={po.receivingReports} poId={po.id} canVoid={canVoid(user) && po.status !== "CLOSED"} voidAction={voidReceivingReportAction} />
        )}
      </div>
      {claimsEnabled && (
        <div className="card">
          <h2>Warranty claims</h2>
          <p className="small muted">Supplier warranty claims for goods received on this PO. Claims are supplier-side only.</p>
          {po.warrantyClaims.length === 0 ? (
            <EmptyState line="No warranty claims filed for this PO yet." />
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Warranty claims">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Fault</th>
                    <th>Status</th>
                    <th>Filed</th>
                    {canEdit && <th aria-label="Move claim" />}
                  </tr>
                </thead>
                <tbody>
                  {po.warrantyClaims.map((c) => (
                    <tr key={c.id}>
                      <td className="small">
                        {c.itemDescription.split("\n")[0]}
                        <div className="faint">
                          {c.receivingReportNumber}
                          {c.serialNumber ? ` · Serial: ${c.serialNumber}` : ""}
                          {c.supplierRef ? ` · Supplier ref: ${c.supplierRef}` : ""}
                        </div>
                      </td>
                      <td className="small" style={{ whiteSpace: "pre-wrap" }}>{c.fault}</td>
                      <td>{WARRANTY_CLAIM_STATUS_LABELS[c.status as WarrantyClaimStatus] ?? c.status}</td>
                      <td className="small">
                        {day(c.createdAt)}
                        <div className="faint">by {c.createdBy}</div>
                      </td>
                      {canEdit && (
                        <td>
                          <WarrantyClaimStatusForm status={c.status} action={changeWarrantyClaimStatusAction.bind(null, po.id, c.id)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canEdit &&
            po.receivingReports.map((r) => (
              <div key={r.id}>
                {r.items.map((x) => (
                  <WarrantyClaimCreateForm
                    key={x.id}
                    itemDescription={x.description}
                    serialNumbers={x.serialNumbers}
                    reportStatus={r.status}
                    action={createWarrantyClaimAction.bind(null, po.id, x.id ?? "")}
                  />
                ))}
              </div>
            ))}
          {!canEdit && <p className="small faint">You need edit rights to file or update claims. Serials on file: {po.receivingReports.flatMap((r) => r.items.flatMap((x) => splitSerialNumbers(x.serialNumbers))).join(", ") || "none"}.</p>}
        </div>
      )}
    </>
  );
}
