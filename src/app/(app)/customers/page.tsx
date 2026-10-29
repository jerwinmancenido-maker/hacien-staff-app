import Link from "next/link";
import type { WithholdingType } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listCustomers } from "@/lib/services/companies";
import { WITHHOLDING_LABELS, WITHHOLDING_TYPES } from "@/lib/validation/companies";
import { formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { Chip, EmptyState, PageHeader, PrimaryCell, type ChipTone } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/Icons";

const TONE: Record<WithholdingType, ChipTone> = { GOVERNMENT: "green", TOP_WITHHOLDING_AGENT: "amber", NONE: "grey" };

type Search = { q?: string; wh?: string; inactive?: string };

function href(s: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  const next = { ...s, ...patch };
  for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
  const qs = p.toString();
  return `/customers${qs ? `?${qs}` : ""}`;
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("view");
  const s = await searchParams;
  const wh = WITHHOLDING_TYPES.includes(s.wh as WithholdingType) ? (s.wh as WithholdingType) : undefined;
  const showInactive = s.inactive === "1";
  const customers = await listCustomers({ q: s.q, withholding: wh, showInactive });
  const filtered = !!(s.q || wh);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Buyers we quote, bill and collect from."
        actions={
          can(user, "edit_data") && (
            <Link className="btn" href="/customers/new">
              <PlusIcon /> New customer
            </Link>
          )
        }
      />
      <div className="toolbar">
        <form className="search-pill" action="/customers" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by name or TIN
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search by name or TIN" />
          {wh && <input type="hidden" name="wh" value={wh} />}
          {showInactive && <input type="hidden" name="inactive" value="1" />}
        </form>
        <Link className={`filter-chip${!wh ? " active" : ""}`} href={href(s, { wh: undefined })}>
          All
        </Link>
        {WITHHOLDING_TYPES.map((t) => (
          <Link key={t} className={`filter-chip${wh === t ? " active" : ""}`} href={href(s, { wh: t })}>
            {WITHHOLDING_LABELS[t]}
          </Link>
        ))}
        <div className="right">
          <Link className={`filter-chip${showInactive ? " active" : ""}`} href={href(s, { inactive: showInactive ? undefined : "1" })} aria-pressed={showInactive}>
            {showInactive ? "Showing inactive" : "Show inactive"}
          </Link>
        </div>
      </div>
      {customers.length === 0 ? (
        <div className="card">
          {filtered ? (
            <EmptyState title="No matches" line="Try another name or TIN, or clear the filter." />
          ) : (
            <EmptyState title="All clear here" line="No customers yet. Add your first customer." />
          )}
        </div>
      ) : (
        <DataTable
          label="Customers"
          columns={[
            { key: "name", label: "Name" },
            { key: "tin", label: "TIN" },
            { key: "wh", label: "Withholding type" },
            { key: "terms", label: "Default terms" },
            { key: "balance", label: "Balance due", numeric: true },
          ]}
          rows={customers.map((c) => ({
            id: c.id,
            href: `/customers/${c.id}`,
            inactive: !c.active,
            cells: {
              name: <PrimaryCell name={c.name} sub={c.active ? c.address?.split("\n")[0] : "Inactive"} />,
              tin: <span className="num" style={{ textAlign: "left" }}>{c.tin ?? <span className="faint">—</span>}</span>,
              wh: <Chip tone={c.active ? TONE[c.withholdingType] : "grey"}>{WITHHOLDING_LABELS[c.withholdingType]}</Chip>,
              terms: c.defaultTerms ?? <span className="faint">—</span>,
              balance: <span className="strong">{formatPeso(0)}</span>,
            },
            sort: { name: c.name, tin: c.tin, wh: WITHHOLDING_LABELS[c.withholdingType], terms: c.defaultTerms, balance: 0 },
          }))}
        />
      )}
    </>
  );
}
