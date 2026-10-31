import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { listCollections } from "@/lib/billing/views";
import { BillingNav } from "@/components/billing/BillingNav";
import { CollectionStatusChip, MethodLabel } from "@/components/billing/BillingParts";
import { EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import type { CollectionStatus } from "@prisma/client";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function CollectionsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; from?: string; to?: string }>;
}) {
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  const status = (sp.status === "POSTED" || sp.status === "VOID" ? sp.status : "ALL") as CollectionStatus | "ALL";
  const fromYmd = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : undefined;
  const toYmd = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : undefined;
  const rows = await listCollections({ status, q: sp.q, fromYmd, toYmd });
  const canManage = can(user, "manage_billing");

  return (
    <>
      <PageHeader
        title="Collections"
        subtitle="Payments and advances. Unapplied cash is customer credit."
        actions={
          canManage && (
            <Link className="btn" href="/billing/collections/new">
              <PlusIcon /> Record collection
            </Link>
          )
        }
      />
      <BillingNav active="collections" />
      <form className="toolbar txn-filters" method="get" action="/billing/collections" style={{ marginBottom: 16 }}>
        <input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Search number, receipt, customer" />
        <select className="input" name="status" defaultValue={status}>
          <option value="ALL">All</option>
          <option value="POSTED">Posted</option>
          <option value="VOID">Void</option>
        </select>
        <input className="input" type="date" name="from" defaultValue={fromYmd ?? ""} aria-label="From collection date" />
        <input className="input" type="date" name="to" defaultValue={toYmd ?? ""} aria-label="To collection date" />
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="All clear here"
            line="No collections yet. Record a collection when a customer pays."
            action={
              canManage ? (
                <Link className="btn btn-secondary" href="/billing/collections/new">
                  Record collection
                </Link>
              ) : (
                <Link className="btn btn-secondary" href="/billing/billings">
                  Open billings
                </Link>
              )
            }
          />
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="list" aria-label="Collections">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Method</th>
                  <th>Receipt</th>
                  <th className="num">Received</th>
                  <th className="num">Applied</th>
                  <th className="num">Credit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable row-has-link">
                    <td>
                      <a href={`/billing/collections/${r.id}`} className="row-stretched-link" tabIndex={-1} aria-hidden />
                      <Link href={`/billing/collections/${r.id}`}>{r.number}</Link>
                    </td>
                    <td>{day(r.date)}</td>
                    <td>
                      <Link href={`/customers/${r.customer.id}`}>{r.customer.name}</Link>
                    </td>
                    <td>
                      <MethodLabel method={r.method} />
                    </td>
                    <td>{r.receiptNo ?? "—"}</td>
                    <td className="num">{formatPeso(r.amountReceived)}</td>
                    <td className="num">{formatPeso(r.cashApplied)}</td>
                    <td className="num">{formatPeso(r.unappliedCredit)}</td>
                    <td>
                      <CollectionStatusChip status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
