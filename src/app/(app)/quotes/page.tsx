import Link from "next/link";
import type { QuoteStatus } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { listQuotesPageView, QUOTE_STATUSES } from "@/lib/quotes/views";
import { formatDate, formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { Chip, EmptyState, PageHeader, PrimaryCell } from "@/components/ui";
import { listBusinesses } from "@/lib/services/businesses";
import { PlusIcon, SearchIcon } from "@/components/Icons";
import { QUOTE_STATUS_LABELS, QuoteStatusChip, QuoteWorkflowApprovalChip } from "@/components/docs/DocParts";
import { QUOTE_APPROVAL_LABELS, quoteHeaderShowsStatusChip } from "@/lib/quotes/approval";

type Search = { q?: string; status?: string; needsApproval?: string; noReply?: string; open?: string; business?: string; page?: string };

function href(s: Search, patch: Partial<Search>) {
  const merged: Search = { ...s, ...patch };
  // Filter/search changes restart at page 1 — only a patch that names the
  // page keeps one.
  if (!("page" in patch)) delete merged.page;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const qs = p.toString();
  return `/quotes${qs ? `?${qs}` : ""}`;
}

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("view");
  const s = await searchParams;
  const needsApproval = s.needsApproval === "1";
  const openOnly = s.open === "1";
  const noReplyDays = s.noReply === "7" ? 7 : undefined;
  const status = QUOTE_STATUSES.includes(s.status as QuoteStatus) ? (s.status as QuoteStatus) : undefined;
  const businesses = await listBusinesses();
  const business =
    s.business === "own" || businesses.some((b) => b.id === s.business) ? s.business : undefined;
  const pageParam = Number.parseInt(s.page ?? "", 10);
  const quotePage = await listQuotesPageView(
    {
      q: s.q,
      status: openOnly ? undefined : status,
      needsApproval: needsApproval || undefined,
      noReplyAfterDays: noReplyDays,
      open: openOnly || undefined,
      businessId: business,
    },
    user,
    Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1,
  );
  const quotes = quotePage.items;
  const withCosts = canSeeCosts(user);
  const filtered = !!(s.q || status || needsApproval || noReplyDays || openOnly || business);

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
        <Link
          className={`filter-chip${!status && !needsApproval && !noReplyDays && !openOnly ? " active" : ""}`}
          href={href(s, { status: undefined, needsApproval: undefined, noReply: undefined, open: undefined })}
        >
          All
        </Link>
        <Link
          className={`filter-chip${openOnly && !needsApproval && !noReplyDays ? " active" : ""}`}
          href={href(s, { status: undefined, needsApproval: undefined, noReply: undefined, open: "1" })}
        >
          Open
        </Link>
        {QUOTE_STATUSES.map((t) => (
          <Link
            key={t}
            className={`filter-chip${status === t && !needsApproval && !noReplyDays && !openOnly ? " active" : ""}`}
            href={href(s, { status: t, needsApproval: undefined, noReply: undefined, open: undefined })}
          >
            {QUOTE_STATUS_LABELS[t]}
          </Link>
        ))}
        {can(user, "approve") && (
          <Link
            className={`filter-chip${needsApproval ? " active" : ""}`}
            href={href(s, { status: undefined, needsApproval: "1", noReply: undefined, open: undefined })}
          >
            Waiting for approval
          </Link>
        )}
        <Link
          className={`filter-chip${noReplyDays ? " active" : ""}`}
          href={href(s, { status: "SENT", needsApproval: undefined, noReply: "7", open: undefined })}
        >
          No reply (7 days)
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
      {quotes.length === 0 ? (
        <div className="card">
          {filtered ? (
            <EmptyState title="No matches" line="Try another number or customer, or clear the filter." />
          ) : (
            <EmptyState
              title="All clear here"
              line="No quotes yet. Price a job for a customer to start."
              action={
                can(user, "edit_data") && (
                  <Link className="btn btn-secondary" href="/quotes/new">
                    New quote
                  </Link>
                )
              }
            />
          )}
        </div>
      ) : (
        <div className="quotes-list">
          <DataTable
            label="Quotes"
            columns={[
              { key: "number", label: "QT no.", className: "qcol-number" },
              { key: "rev", label: "Rev", numeric: true, className: "qcol-rev" },
              { key: "customer", label: "Customer", className: "qcol-customer" },
              { key: "total", label: "Total", numeric: true, className: "qcol-total" },
              ...(withCosts ? [{ key: "margin", label: "Margin %", numeric: true, className: "qcol-margin" }] : []),
              { key: "status", label: "Status", className: "qcol-status" },
              { key: "valid", label: "Valid until", className: "qcol-valid" },
            ]}
            rows={quotes.map((q) => ({
              id: q.id,
              href: `/quotes/${q.id}`,
              inactive: q.status === "VOID",
              cells: {
                number: (
                  <div className="cell-primary">
                    <div>
                      <div className="title">
                        {q.number} {q.businessShortLabel && <Chip tone="dark">{q.businessShortLabel}</Chip>}
                      </div>
                      <div className="sub">{formatDate(day(q.date))}</div>
                    </div>
                  </div>
                ),
                rev: q.revision,
                customer: <PrimaryCell name={q.customerName} />,
                total: <span className="strong">{formatPeso(q.contractPrice)}</span>,
                margin:
                  q.netMarginPct !== undefined ? (q.supplierCostState === "none" ? "—" : `${q.netMarginPct}%`) : null,
                status: (
                  <>
                    {quoteHeaderShowsStatusChip(q.status, q.approvalStatus) && (
                      <QuoteStatusChip status={q.status} />
                    )}
                    {q.status !== "VOID" && q.approvalStatus !== "PENDING" && (
                      <QuoteWorkflowApprovalChip
                        status={q.approvalStatus}
                        label={QUOTE_APPROVAL_LABELS[q.approvalStatus]}
                      />
                    )}
                  </>
                ),
                valid: formatDate(day(q.validUntil)),
              },
              sort: {
                number: q.number,
                rev: q.revision,
                customer: q.customerName,
                total: Number(q.contractPrice),
                margin: q.netMarginPct !== undefined && q.supplierCostState !== "none" ? Number(q.netMarginPct) : null,
                status: q.status,
                valid: q.validUntil,
              },
            }))}
          />
        </div>
      )}
      {quotePage.totalPages > 1 && (
        <div className="toolbar" style={{ marginTop: 10 }}>
          <span className="small faint">
            Page {quotePage.page} of {quotePage.totalPages} · {quotePage.total} records
          </span>
          {quotePage.page > 1 && (
            <Link
              className="btn btn-secondary"
              href={href(s, { page: quotePage.page - 1 > 1 ? String(quotePage.page - 1) : undefined })}
            >
              Prev
            </Link>
          )}
          {quotePage.page < quotePage.totalPages && (
            <Link className="btn btn-secondary" href={href(s, { page: String(quotePage.page + 1) })}>
              Next
            </Link>
          )}
        </div>
      )}
    </>
  );
}
