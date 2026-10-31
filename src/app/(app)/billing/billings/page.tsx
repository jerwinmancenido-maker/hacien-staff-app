import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { listBillings, BILLING_STATUSES, BILLING_STATUS_LABELS } from "@/lib/billing/views";
import type { BillingStatus } from "@prisma/client";
import { BillingNav } from "@/components/billing/BillingNav";
import { BillingStatusChip, OverdueBadge } from "@/components/billing/BillingParts";
import { PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function BillingsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; customerId?: string }>;
}) {
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  const statusRaw = sp.status ?? "ALL";
  const status =
    statusRaw === "ALL" || statusRaw === "OVERDUE" || (BILLING_STATUSES as string[]).includes(statusRaw)
      ? (statusRaw as BillingStatus | "ALL" | "OVERDUE")
      : "ALL";
  const rows = await listBillings({ status, q: sp.q, customerId: sp.customerId });
  const canManage = can(user, "manage_billing");

  return (
    <>
      <PageHeader
        title="Billings"
        subtitle="Records of hand-written booklet invoices (not official invoices)."
        actions={
          canManage && (
            <Link className="btn" href="/billing/billings/new">
              <PlusIcon /> Record billing
            </Link>
          )
        }
      />
      <BillingNav active="billings" />

      <form className="toolbar txn-filters" method="get" action="/billing/billings" style={{ marginBottom: 16 }}>
        <input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Search number, customer, booklet no." />
        <select className="input" name="status" defaultValue={status}>
          <option value="ALL">All statuses</option>
          <option value="OVERDUE">Overdue</option>
          {BILLING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BILLING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>

      <div className="card">
        <div className="table-wrap">
          <table className="list" aria-label="Billings">
            <thead>
              <tr>
                <th>Booklet no.</th>
                <th>Internal</th>
                <th>Customer</th>
                <th>SO</th>
                <th>Invoice date</th>
                <th>Due</th>
                <th className="num">Amount</th>
                <th className="num">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="faint">
                    No billings yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/billing/billings/${r.id}`}>{r.invoiceNo}</Link>
                    </td>
                    <td className="faint">{r.number}</td>
                    <td>
                      <Link href={`/customers/${r.customer.id}`}>{r.customer.name}</Link>
                    </td>
                    <td>
                      <Link href={`/sales-orders/${r.salesOrder.id}`}>{r.salesOrder.number}</Link>
                    </td>
                    <td>{day(r.invoiceDate)}</td>
                    <td>{day(r.dueDate)}</td>
                    <td className="num">{formatPeso(r.amount)}</td>
                    <td className="num strong">{formatPeso(r.balance)}</td>
                    <td>
                      <BillingStatusChip status={r.status} /> <OverdueBadge label={r.overdue.label} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
