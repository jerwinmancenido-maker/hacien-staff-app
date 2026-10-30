import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { getReceivingView } from "@/lib/purchasing/views";
import { EmptyState, PageHeader } from "@/components/ui";
import { day, PoStatusChip, QtyBar, qtyText } from "@/components/purchasing/PoParts";
import { RrTable } from "@/components/purchasing/RrTable";
import { voidReceivingReportAction } from "../actions";

// Receiving view of a PO: quantities only (no unit costs, totals or amounts).
export default async function ReceivingPoPage({ params, searchParams }: { params: Promise<{ poId: string }>; searchParams: Promise<{ posted?: string }> }) {
  const user = await requirePagePermission("view");
  const { poId } = await params;
  const { posted } = await searchParams;
  const po = await getReceivingView(poId, user);
  if (!po) notFound();
  const canEdit = can(user, "edit_data");

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
                  <td style={{ whiteSpace: "pre-wrap" }}>{l.description}</td>
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
          <RrTable reports={po.receivingReports} poId={po.id} canEdit={canEdit && po.status !== "CLOSED"} voidAction={voidReceivingReportAction} />
        )}
      </div>
    </>
  );
}
