import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { listBillingsPage, BILLING_STATUSES, BILLING_STATUS_LABELS } from "@/lib/billing/views";
import { parsePageParam } from "@/lib/paging";
import { ListPager } from "@/components/ListPager";
import type { BillingStatus } from "@prisma/client";
import { BillingNav } from "@/components/billing/BillingNav";
import { BillingStatusChip, OverdueBadge } from "@/components/billing/BillingParts";
import { EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function BillingsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; customerId?: string; from?: string; to?: string; page?: string; pageSize?: string }>;
}) {
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  const statusRaw = sp.status ?? "ALL";
  const status =
    statusRaw === "ALL" || statusRaw === "OVERDUE" || (BILLING_STATUSES as string[]).includes(statusRaw)
      ? (statusRaw as BillingStatus | "ALL" | "OVERDUE")
      : "ALL";
  const fromYmd = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : undefined;
  const toYmd = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : undefined;
  const pageParam = parsePageParam(sp.page);
  const pageSizeParam = sp.pageSize ? Number.parseInt(sp.pageSize, 10) : undefined;
  const {
    rows,
    total,
    page: currentPage,
    pageSize: currentPageSize,
    totalPages,
  } = await listBillingsPage({
    status,
    q: sp.q,
    customerId: sp.customerId,
    fromYmd,
    toYmd,
    page: pageParam,
    pageSize: pageSizeParam,
  });
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (sp.q) params.set("q", sp.q);
    if (sp.customerId) params.set("customerId", sp.customerId);
    if (fromYmd) params.set("from", fromYmd);
    if (toYmd) params.set("to", toYmd);
    params.set("pageSize", String(currentPageSize));
    params.set("page", String(target));
    return `/billing/billings?${params.toString()}`;
  };
  const canRecord = can(user, "record_billing");

  return (
    <>
      <PageHeader
        title="Billings"
        subtitle="Records of hand-written booklet invoices (not official invoices)."
        actions={
          canRecord && (
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
        <input className="input" type="date" name="from" defaultValue={fromYmd ?? ""} aria-label="From invoice date" />
        <input className="input" type="date" name="to" defaultValue={toYmd ?? ""} aria-label="To invoice date" />
        {sp.customerId ? <input type="hidden" name="customerId" value={sp.customerId} /> : null}
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="All clear here"
            line="No billings yet. Bill a sales order to start."
            action={
              <Link className="btn btn-secondary" href="/sales-orders">
                Open sales orders
              </Link>
            }
          />
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="list billing-list-table" aria-label="Billings">
              <thead>
                <tr>
                  <th>Booklet no.</th>
                  <th className="col-tab-cap">Customer</th>
                  <th className="col-phone-hide col-tab-hide">SO</th>
                  <th className="col-phone-hide col-tab-hide">Invoice date</th>
                  <th className="col-phone-hide col-tab-hide">Due</th>
                  <th className="num col-phone-hide">Amount</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable row-has-link">
                    <td data-col="number">
                      <a href={`/billing/billings/${r.id}`} className="row-stretched-link" tabIndex={-1} aria-hidden />
                      <Link href={`/billing/billings/${r.id}`}>{r.invoiceNo}</Link>
                      <div className="small faint">{r.number}</div>
                    </td>
                    <td className="col-tab-cap">
                      <Link href={`/customers/${r.customer.id}`}>{r.customer.name}</Link>
                    </td>
                    <td data-col="number" className="col-phone-hide col-tab-hide">
                      <Link href={`/sales-orders/${r.salesOrder.id}`}>{r.salesOrder.number}</Link>
                    </td>
                    <td data-col="date" className="col-phone-hide col-tab-hide">{day(r.invoiceDate)}</td>
                    {/* The "Expected by … (estimate)" label is prose and may wrap;
                        a plain due date gets the no-wrap date treatment. */}
                    {r.expectedPaymentLabel ? (
                      <td className="col-phone-hide col-tab-hide">{r.expectedPaymentLabel}</td>
                    ) : (
                      <td data-col="date" className="col-phone-hide col-tab-hide">{day(r.dueDate)}</td>
                    )}
                    <td className="num col-phone-hide">{formatPeso(r.amount)}</td>
                    <td className="num strong">{formatPeso(r.balance)}</td>
                    <td data-col="status">
                      <BillingStatusChip status={r.status} /> {!r.isGovernment && <OverdueBadge label={r.overdue.label} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ListPager
        page={currentPage}
        totalPages={totalPages}
        total={total}
        hrefFor={pageHref}
        jumpAction="/billing/billings"
        jumpParams={{
          status: status !== "ALL" ? status : undefined,
          q: sp.q,
          customerId: sp.customerId,
          from: fromYmd,
          to: toYmd,
          pageSize: String(currentPageSize),
        }}
      />
    </>
  );
}
