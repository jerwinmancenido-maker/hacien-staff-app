import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import { listPurchaseOrdersView, PO_STATUSES } from "@/lib/purchasing/views";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/purchasing/status";
import { formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { EmptyState, PageHeader, PrimaryCell } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/Icons";
import { day, PoStatusChip } from "@/components/purchasing/PoParts";

type Search = { q?: string; status?: string; billedOver?: string };

function href(s: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...s, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return `/purchase-orders${qs ? `?${qs}` : ""}`;
}

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Audit F: every viewer can list POs; money stays cost-only.
  const user = await requirePagePermission("view");
  const withCosts = canSeeCosts(user);
  const s = await searchParams;
  const billedOver = s.billedOver === "1" && withCosts;
  const status = PO_STATUSES.includes(s.status as PoStatus) ? (s.status as PoStatus) : undefined;
  const pos = await listPurchaseOrdersView({ q: s.q, status, billedOver: billedOver || undefined }, user);
  const filtered = !!(s.q || status || billedOver);

  return (
    <>
      <PageHeader
        title="Supplier POs"
        subtitle="Purchase orders to suppliers. Create them from a sales order, or a standalone PO."
        actions={
          user.isAdmin && withCosts && (
            <Link className="btn" href="/purchase-orders/new">
              <PlusIcon /> New standalone PO
            </Link>
          )
        }
      />
      <div className="toolbar">
        <form className="search-pill" action="/purchase-orders" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by PO number, supplier or SO number
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search PO no., supplier or SO no." />
          {status && <input type="hidden" name="status" value={status} />}
        </form>
        <Link
          className={`filter-chip${!status && !billedOver ? " active" : ""}`}
          href={href(s, { status: undefined, billedOver: undefined })}
        >
          All
        </Link>
        {PO_STATUSES.map((t) => (
          <Link
            key={t}
            className={`filter-chip${status === t && !billedOver ? " active" : ""}`}
            href={href(s, { status: t, billedOver: undefined })}
          >
            {PO_STATUS_LABELS[t]}
          </Link>
        ))}
        {withCosts && (
          <Link
            className={`filter-chip${billedOver ? " active" : ""}`}
            href={href(s, { status: undefined, billedOver: "1" })}
          >
            Bill higher than PO
          </Link>
        )}
      </div>
      {pos.length === 0 ? (
        <div className="card">
          {filtered ? (
            <EmptyState title="No matches" line="Try another number or supplier, or clear the filter." />
          ) : (
            <EmptyState
              title="All clear here"
              line="No supplier POs yet. Open a sales order and choose Create POs."
              action={
                <Link className="btn btn-secondary" href="/sales-orders">
                  Open sales orders
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <DataTable
          label="Supplier POs"
          columns={[
            { key: "number", label: "PO no." },
            { key: "supplier", label: "Supplier" },
            { key: "so", label: "Sales order" },
            // Audit F: no Total column for non-cost viewers.
            ...(withCosts ? [{ key: "total", label: "Total", numeric: true } as const] : []),
            { key: "status", label: "Status" },
            { key: "date", label: "Date" },
            { key: "expected", label: "Expected" },
          ]}
          rows={pos.map((o) => ({
            id: o.id,
            href: `/purchase-orders/${o.id}`,
            inactive: o.status === "VOID",
            cells: {
              number: <span className="strong">{o.number}</span>,
              supplier: <PrimaryCell name={o.supplierName} />,
              so: o.salesOrder?.number ?? <span className="faint">Standalone</span>,
              total: o.subtotal == null ? "" : <span className="strong">{formatPeso(o.subtotal)}</span>,
              status: <PoStatusChip status={o.status} />,
              date: day(o.date),
              expected: day(o.expectedDate),
            },
            sort: { number: o.number, supplier: o.supplierName, so: o.salesOrder?.number ?? "", total: Number(o.subtotal ?? 0), status: o.status, date: o.date, expected: o.expectedDate ?? "" },
          }))}
        />
      )}
    </>
  );
}
