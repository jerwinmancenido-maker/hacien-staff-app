import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getSalesOrderView } from "@/lib/quotes/views";
import { formatDate } from "@/lib/format";
import { Activity } from "@/components/Activity";
import { PageHeader } from "@/components/ui";
import { ItemsTable, QuoteStatusChip, SoStatusChip, TotalsBox } from "@/components/docs/DocParts";
import { SalesOrderActions } from "@/components/docs/QuoteActions";
import { voidSalesOrderAction } from "../actions";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  // Built on the server without cost fields for users who can't see costs.
  const so = await getSalesOrderView(id, user);
  if (!so) notFound();

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
        actions={<SalesOrderActions id={so.id} number={so.number} status={so.status} canEdit={can(user, "edit_data")} voidAction={voidSalesOrderAction} />}
      />
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
    </>
  );
}
