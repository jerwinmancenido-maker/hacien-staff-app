import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getSalesOrderView } from "@/lib/quotes/views";
import { getSoPurchasing } from "@/lib/purchasing/views";
import { formatDate } from "@/lib/format";
import { Activity } from "@/components/Activity";
import { PageHeader } from "@/components/ui";
import { ItemsTable, QuoteStatusChip, SoStatusChip, TotalsBox } from "@/components/docs/DocParts";
import { SalesOrderActions } from "@/components/docs/QuoteActions";
import { PoStatusChip, ProgressChip, QtyBar, qtyText } from "@/components/purchasing/PoParts";
import { voidSalesOrderAction } from "../actions";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export default async function SalesOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { created } = await searchParams;
  // Built on the server without cost fields for users who can't see costs.
  const so = await getSalesOrderView(id, user);
  if (!so) notFound();
  // PO numbers for everyone; links (and Create POs) only for cost users.
  const purchasing = await getSoPurchasing(so.id, user);
  const progress = new Map(purchasing.lines.map((l) => [l.id, l]));
  const canCreatePos = so.canSeeCosts && can(user, "edit_data") && so.status === "OPEN" && so.quote.status === "WON" && purchasing.ordered < purchasing.total;

  return (
    <>
      <PageHeader
        title={
          <>
            {so.number}
            <SoStatusChip status={so.status} />
          </>
        }
        subtitle={`${so.customer.name} · Buyer PO ${so.buyerPoNo ?? "—"}`}
        actions={
          <>
            {canCreatePos && (
              <Link className="btn btn-secondary" href={`/sales-orders/${so.id}/purchase-orders`}>
                Create POs
              </Link>
            )}
            <SalesOrderActions id={so.id} number={so.number} status={so.status} canEdit={can(user, "edit_data")} voidAction={voidSalesOrderAction} />
          </>
        }
      />
      {created && (
        <div className="alert ok" role="status">
          Created {created} draft PO{created === "1" ? "" : "s"}. They need approval before they&apos;re sent.
        </div>
      )}
      {so.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {so.voidReason}
        </div>
      )}
      <div className="detail-grid">
        <div>
          <div className="card">
            <dl className="kv kv-grid">
              <dt>Customer</dt>
              <dd>
                <Link href={`/customers/${so.customer.id}`}>{so.customer.name}</Link>
              </dd>
              <dt>From quote</dt>
              <dd>
                <Link href={`/quotes/${so.quote.id}`}>{so.quote.number}</Link> <QuoteStatusChip status={so.quote.status} />
              </dd>
              <dt>Buyer PO no.</dt>
              <dd>{so.buyerPoNo ?? "—"}</dd>
              <dt>Buyer PO date</dt>
              <dd>{day(so.buyerPoDate)}</dd>
              <dt>SO date</dt>
              <dd>{day(so.date)}</dd>
              <dt>Contact</dt>
              <dd>{so.contact ? `${so.contact.name}${so.contact.email ? ` · ${so.contact.email}` : ""}` : "—"}</dd>
              <dt>Delivery address</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{so.deliveryAddress ?? "—"}</dd>
              <dt>Terms</dt>
              <dd>{so.terms ?? "—"}</dd>
              <dt>Withholding</dt>
              <dd>{so.withholding.length ? so.withholding.map((w) => w.label).join(", ") : "None"}</dd>
              {so.notes && (
                <>
                  <dt>Notes</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{so.notes}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
        <Activity targets={[{ entityType: "SalesOrder", ids: [so.id] }]} viewer={user} />
      </div>
      <div className="card">
        <h2>Items</h2>
        <ItemsTable items={so.items} showCosts={so.canSeeCosts} />
        <div className="totals-wrap">
          <TotalsBox totals={so.totals} showCosts={so.canSeeCosts} />
        </div>
      </div>
      <div className="card" aria-label="Purchasing">
        <div className="card-head">
          <h2>Purchasing</h2>
          <div className="right small muted">
            {purchasing.received} of {purchasing.total} line{purchasing.total === 1 ? "" : "s"} received · {purchasing.ordered} ordered
          </div>
        </div>
        <div className="table-wrap">
          <table className="list" aria-label="Purchasing progress">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Supplier PO</th>
                <th className="num">SO qty</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th aria-label="Progress" />
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {so.items.map((i, n) => {
                const p = progress.get(i.id);
                if (!p) return null;
                return (
                  <tr key={i.id}>
                    <td className="faint">{n + 1}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{i.description.split("\n")[0]}</td>
                    <td>
                      {p.purchaseOrders.length === 0 && <span className="faint">—</span>}
                      {p.purchaseOrders.map((po) => (
                        <div key={po.number}>
                          {po.id ? <Link href={`/purchase-orders/${po.id}`}>{po.number}</Link> : po.number} <PoStatusChip status={po.status} />
                        </div>
                      ))}
                    </td>
                    <td className="num">
                      {qtyText(i.qty)} {i.unit}
                    </td>
                    <td className="num">{qtyText(p.ordered)}</td>
                    <td className="num">{qtyText(p.received)}</td>
                    <td style={{ minWidth: 80 }}>
                      <QtyBar received={p.received} ordered={i.qty} label={`Received ${qtyText(p.received)} of ${qtyText(i.qty)}`} />
                    </td>
                    <td>
                      <ProgressChip state={p.state} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
