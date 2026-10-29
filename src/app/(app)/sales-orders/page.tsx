import Link from "next/link";
import type { SalesOrderStatus } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { listSalesOrdersView, SALES_ORDER_STATUSES } from "@/lib/quotes/views";
import { formatDate, formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { EmptyState, PageHeader, PrimaryCell } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";
import { SO_STATUS_LABELS, SoStatusChip } from "@/components/docs/DocParts";

type Search = { q?: string; status?: string };

function href(s: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...s, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return `/sales-orders${qs ? `?${qs}` : ""}`;
}

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission("view");
  const s = await searchParams;
  const status = SALES_ORDER_STATUSES.includes(s.status as SalesOrderStatus) ? (s.status as SalesOrderStatus) : undefined;
  const orders = await listSalesOrdersView({ q: s.q, status });
  const filtered = !!(s.q || status);

  return (
    <>
      <PageHeader title="Sales Orders" subtitle="Won quotes. Convert a quote to create one." />
      <div className="toolbar">
        <form className="search-pill" action="/sales-orders" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by SO number, buyer PO or customer
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search SO no., buyer PO or customer" />
          {status && <input type="hidden" name="status" value={status} />}
        </form>
        <Link className={`filter-chip${!status ? " active" : ""}`} href={href(s, { status: undefined })}>
          All
        </Link>
        {SALES_ORDER_STATUSES.map((t) => (
          <Link key={t} className={`filter-chip${status === t ? " active" : ""}`} href={href(s, { status: t })}>
            {SO_STATUS_LABELS[t]}
          </Link>
        ))}
      </div>
      {orders.length === 0 ? (
        <div className="card">
          {filtered ? (
            <EmptyState title="No matches" line="Try another number or customer, or clear the filter." />
          ) : (
            <EmptyState title="All clear here" line="No sales orders yet. Convert a won quote to make one." />
          )}
        </div>
      ) : (
        <DataTable
          label="Sales orders"
          columns={[
            { key: "number", label: "SO no." },
            { key: "customer", label: "Customer" },
            { key: "po", label: "Buyer PO" },
            { key: "total", label: "Total", numeric: true },
            { key: "status", label: "Status" },
            { key: "date", label: "Date" },
          ]}
          rows={orders.map((o) => ({
            id: o.id,
            href: `/sales-orders/${o.id}`,
            inactive: o.status === "VOID",
            cells: {
              number: <span className="strong">{o.number}</span>,
              customer: <PrimaryCell name={o.customerName} />,
              po: o.buyerPoNo ?? <span className="faint">—</span>,
              total: <span className="strong">{formatPeso(o.contractPrice)}</span>,
              status: <SoStatusChip status={o.status} />,
              date: formatDate(new Date(`${o.date}T00:00:00.000Z`)),
            },
            sort: { number: o.number, customer: o.customerName, po: o.buyerPoNo, total: Number(o.contractPrice), status: o.status, date: o.date },
          }))}
        />
      )}
    </>
  );
}
