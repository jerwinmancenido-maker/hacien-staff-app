import Link from "next/link";
import type { SalesOrderStatus } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { listSalesOrdersView, SALES_ORDER_STATUSES } from "@/lib/quotes/views";
import { formatDate, formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { Chip, EmptyState, PageHeader, PrimaryCell } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";
import { SO_STATUS_LABELS, SoStatusChip } from "@/components/docs/DocParts";
import { listBusinesses } from "@/lib/services/businesses";

type Search = { q?: string; status?: string; needsPo?: string; open?: string; toDeliver?: string; business?: string };

function href(s: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...s, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return `/sales-orders${qs ? `?${qs}` : ""}`;
}

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission("view");
  const s = await searchParams;
  const needsPo = s.needsPo === "1";
  const openOnly = s.open === "1";
  const toDeliver = s.toDeliver === "1";
  const status = SALES_ORDER_STATUSES.includes(s.status as SalesOrderStatus) ? (s.status as SalesOrderStatus) : undefined;
  const businesses = await listBusinesses();
  const business =
    s.business === "own" || businesses.some((b) => b.id === s.business) ? s.business : undefined;
  const orders = await listSalesOrdersView({
    q: s.q,
    status: openOnly || needsPo || toDeliver ? undefined : status,
    needsPo: needsPo || undefined,
    open: openOnly || undefined,
    toDeliver: toDeliver || undefined,
    businessId: business,
  });
  const filtered = !!(s.q || status || needsPo || openOnly || toDeliver || business);

  return (
    <>
      <PageHeader title="Sales Orders" subtitle="Won quotes. Convert a quote to create one." />
      <div className="toolbar">
        <form className="search-pill" action="/sales-orders" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by SO number, buyer PO, customer, or serial number
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search SO no., buyer PO, customer, or serial" />
          {status && <input type="hidden" name="status" value={status} />}
        </form>
        <Link
          className={`filter-chip${!status && !needsPo && !openOnly && !toDeliver ? " active" : ""}`}
          href={href(s, { status: undefined, needsPo: undefined, open: undefined, toDeliver: undefined })}
        >
          All
        </Link>
        {/* S-81: this is OPEN orders with money still to bill — not the same
            as the plain OPEN status chip below, so it gets its own label. */}
        <Link
          className={`filter-chip${openOnly && !needsPo && !toDeliver ? " active" : ""}`}
          href={href(s, { status: undefined, needsPo: undefined, open: "1", toDeliver: undefined })}
        >
          Still to bill
        </Link>
        <Link
          className={`filter-chip${toDeliver ? " active" : ""}`}
          href={href(s, { status: undefined, needsPo: undefined, open: undefined, toDeliver: "1" })}
        >
          Still to deliver
        </Link>
        {SALES_ORDER_STATUSES.map((t) => (
          <Link
            key={t}
            className={`filter-chip${status === t && !needsPo && !openOnly && !toDeliver ? " active" : ""}`}
            href={href(s, { status: t, needsPo: undefined, open: undefined, toDeliver: undefined })}
          >
            {SO_STATUS_LABELS[t]}
          </Link>
        ))}
        <Link
          className={`filter-chip${needsPo ? " active" : ""}`}
          href={href(s, { status: undefined, needsPo: "1", open: undefined, toDeliver: undefined })}
        >
          Needs supplier PO
        </Link>
        <Link className="filter-chip" href="/sales-orders/aging">
          Aging
        </Link>
        <Link className="filter-chip" href="/sales-orders/dispatch">
          Dispatch queue
        </Link>
      </div>
      {businesses.length > 0 && (
        <div className="toolbar" style={{ marginTop: 6 }}>
          <span className="small faint">Business:</span>
          <Link className={`filter-chip${!business ? " active" : ""}`} href={href(s, { business: undefined })}>
            All
          </Link>
          <Link className={`filter-chip${business === "own" ? " active" : ""}`} href={href(s, { business: "own" })}>
            Own company
          </Link>
          {businesses.filter((b) => b.active || b.id === business).map((b) => (
            <Link key={b.id} className={`filter-chip${business === b.id ? " active" : ""}`} href={href(s, { business: b.id })}>
              {b.shortLabel}
            </Link>
          ))}
        </div>
      )}
      {orders.length === 0 ? (
        <div className="card">
          {filtered ? (
            <EmptyState title="No matches" line="Try another number or customer, or clear the filter." />
          ) : (
            <EmptyState
              title="All clear here"
              line="No sales orders yet. Convert a won quote to make one."
              action={
                <Link className="btn btn-secondary" href="/quotes">
                  Open quotes
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <DataTable
          label="Sales orders"
          columns={[
            { key: "number", label: "SO no." },
            { key: "customer", label: "Customer" },
            { key: "po", label: "Buyer PO", className: "col-phone-hide" },
            { key: "total", label: "Total", numeric: true },
            { key: "status", label: "Status" },
            { key: "date", label: "Date", className: "col-phone-hide" },
          ]}
          rows={orders.map((o) => ({
            id: o.id,
            href: `/sales-orders/${o.id}`,
            inactive: o.status === "VOID",
            cells: {
              number: (
                <span className="strong">
                  {o.number} {o.businessShortLabel && <Chip tone="dark">{o.businessShortLabel}</Chip>}
                </span>
              ),
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
