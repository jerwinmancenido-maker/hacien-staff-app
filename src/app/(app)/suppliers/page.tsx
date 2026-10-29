import Link from "next/link";
import type { SupplierTaxType } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listSuppliers } from "@/lib/services/companies";
import { missingBankDetails, SUPPLIER_TAX_TYPES, TAX_TYPE_LABELS } from "@/lib/validation/companies";
import { formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { Chip, EmptyState, PageHeader, PrimaryCell, type ChipTone } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/Icons";

const TONE: Record<SupplierTaxType, ChipTone> = { VAT: "green", NON_VAT: "grey", NO_RECEIPT: "amber" };

type Search = { q?: string; tax?: string; inactive?: string };

function href(s: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...s, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return `/suppliers${qs ? `?${qs}` : ""}`;
}

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("view");
  const s = await searchParams;
  const tax = SUPPLIER_TAX_TYPES.includes(s.tax as SupplierTaxType) ? (s.tax as SupplierTaxType) : undefined;
  const showInactive = s.inactive === "1";
  const suppliers = await listSuppliers({ q: s.q, taxType: tax, showInactive });
  const filtered = !!(s.q || tax);

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Who we buy from and how we pay them."
        actions={
          can(user, "edit_data") && (
            <Link className="btn" href="/suppliers/new">
              <PlusIcon /> New supplier
            </Link>
          )
        }
      />
      <div className="toolbar">
        <form className="search-pill" action="/suppliers" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by name or TIN
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search by name or TIN" />
          {tax && <input type="hidden" name="tax" value={tax} />}
          {showInactive && <input type="hidden" name="inactive" value="1" />}
        </form>
        <Link className={`filter-chip${!tax ? " active" : ""}`} href={href(s, { tax: undefined })}>
          All
        </Link>
        {SUPPLIER_TAX_TYPES.map((t) => (
          <Link key={t} className={`filter-chip${tax === t ? " active" : ""}`} href={href(s, { tax: t })}>
            {TAX_TYPE_LABELS[t]}
          </Link>
        ))}
        <div className="right">
          <Link className={`filter-chip${showInactive ? " active" : ""}`} href={href(s, { inactive: showInactive ? undefined : "1" })} aria-pressed={showInactive}>
            {showInactive ? "Showing inactive" : "Show inactive"}
          </Link>
        </div>
      </div>
      {suppliers.length === 0 ? (
        <div className="card">
          {filtered ? <EmptyState title="No matches" line="Try another name or TIN, or clear the filter." /> : <EmptyState line="No suppliers yet." />}
        </div>
      ) : (
        <DataTable
          label="Suppliers"
          columns={[
            { key: "name", label: "Name" },
            { key: "tin", label: "TIN" },
            { key: "tax", label: "Tax type" },
            { key: "terms", label: "Default terms" },
            { key: "owe", label: "We owe", numeric: true },
          ]}
          rows={suppliers.map((x) => ({
            id: x.id,
            href: `/suppliers/${x.id}`,
            inactive: !x.active,
            cells: {
              name: <PrimaryCell name={x.name} sub={!x.active ? "Inactive" : missingBankDetails(x) ? "No bank details" : x.bankBranch ?? undefined} />,
              tin: x.tin ?? <span className="faint">—</span>,
              tax: <Chip tone={x.active ? TONE[x.taxType] : "grey"}>{TAX_TYPE_LABELS[x.taxType]}</Chip>,
              terms: x.defaultTerms ?? <span className="faint">—</span>,
              owe: <span className="strong">{formatPeso(0)}</span>,
            },
            sort: { name: x.name, tin: x.tin, tax: TAX_TYPE_LABELS[x.taxType], terms: x.defaultTerms, owe: 0 },
          }))}
        />
      )}
    </>
  );
}
