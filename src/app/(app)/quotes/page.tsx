import Link from "next/link";
import type { QuoteStatus } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { listQuotesView, QUOTE_STATUSES } from "@/lib/quotes/views";
import { formatDate, formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { EmptyState, PageHeader, PrimaryCell } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/Icons";
import { QUOTE_STATUS_LABELS, QuoteStatusChip } from "@/components/docs/DocParts";

type Search = { q?: string; status?: string };

function href(s: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...s, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return `/quotes${qs ? `?${qs}` : ""}`;
}

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("view");
  const s = await searchParams;
  const status = QUOTE_STATUSES.includes(s.status as QuoteStatus) ? (s.status as QuoteStatus) : undefined;
  const quotes = await listQuotesView({ q: s.q, status }, user);
  const withCosts = canSeeCosts(user);
  const filtered = !!(s.q || status);

  return (
    <>
      <PageHeader
        title="Quotes"
        subtitle="Priced from supplier costs plus markup. A won quote becomes a sales order."
        actions={
          can(user, "edit_data") && (
            <Link className="btn" href="/quotes/new">
              <PlusIcon /> New quote
            </Link>
          )
        }
      />
      <div className="toolbar">
        <form className="search-pill" action="/quotes" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by quote number or customer
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search QT no. or customer" />
          {status && <input type="hidden" name="status" value={status} />}
        </form>
        <Link className={`filter-chip${!status ? " active" : ""}`} href={href(s, { status: undefined })}>
          All
        </Link>
        {QUOTE_STATUSES.map((t) => (
          <Link key={t} className={`filter-chip${status === t ? " active" : ""}`} href={href(s, { status: t })}>
            {QUOTE_STATUS_LABELS[t]}
          </Link>
        ))}
      </div>
      {quotes.length === 0 ? (
        <div className="card">
          {filtered ? <EmptyState title="No matches" line="Try another number or customer, or clear the filter." /> : <EmptyState title="All clear here" line="No quotes yet." />}
        </div>
      ) : (
        <DataTable
          label="Quotes"
          columns={[
            { key: "number", label: "QT no." },
            { key: "rev", label: "Rev", numeric: true },
            { key: "customer", label: "Customer" },
            { key: "total", label: "Total", numeric: true },
            ...(withCosts ? [{ key: "margin", label: "Margin %", numeric: true }] : []),
            { key: "status", label: "Status" },
            { key: "valid", label: "Valid until" },
          ]}
          rows={quotes.map((q) => ({
            id: q.id,
            href: `/quotes/${q.id}`,
            inactive: q.status === "VOID",
            cells: {
              number: (
                <div className="cell-primary">
                  <div>
                    <div className="title">{q.number}</div>
                    <div className="sub">{formatDate(day(q.date))}</div>
                  </div>
                </div>
              ),
              rev: q.revision,
              customer: <PrimaryCell name={q.customerName} />,
              total: <span className="strong">{formatPeso(q.contractPrice)}</span>,
              margin: q.netMarginPct !== undefined ? `${q.netMarginPct}%` : null,
              status: <QuoteStatusChip status={q.status} />,
              valid: formatDate(day(q.validUntil)),
            },
            sort: {
              number: q.number,
              rev: q.revision,
              customer: q.customerName,
              total: Number(q.contractPrice),
              margin: q.netMarginPct !== undefined ? Number(q.netMarginPct) : null,
              status: q.status,
              valid: q.validUntil,
            },
          }))}
        />
      )}
    </>
  );
}
