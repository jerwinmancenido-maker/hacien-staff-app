import Link from "next/link";
import type { SupplierTaxType } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listSuppliers } from "@/lib/services/companies";
import { missingBankDetails, SUPPLIER_TAX_TYPES, TAX_TYPE_LABELS } from "@/lib/validation/companies";
import { formatPeso } from "@/lib/format";
import { RecordList, type RecordItem } from "@/components/RecordList";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader, type ChipTone } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/Icons";

const TONE: Record<SupplierTaxType, ChipTone> = {
  VAT: "green",
  NON_VAT: "grey",
  NO_RECEIPT: "amber",
};

type Search = { q?: string; tax?: string; inactive?: string; view?: string };

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

  const filterTabs = [
    { key: "all", label: "All", href: href(s, { tax: undefined }) },
    ...SUPPLIER_TAX_TYPES.map((t) => ({
      key: t,
      label: TAX_TYPE_LABELS[t],
      href: href(s, { tax: t }),
    })),
  ];

  const items: RecordItem[] = suppliers.map((x) => {
    const isMissingBank = missingBankDetails(x);
    return {
      id: x.id,
      href: `/suppliers/${x.id}`,
      inactive: !x.active,
      avatarName: x.name,
      title: x.name,
      subtitle: x.tin ? (
        <span className="num" style={{ textAlign: "left" }}>
          {x.tin}
        </span>
      ) : !x.active ? (
        "Inactive"
      ) : isMissingBank ? (
        "No bank details"
      ) : (
        x.bankBranch || "Supplier"
      ),
      chips: [
        {
          label: TAX_TYPE_LABELS[x.taxType],
          tone: x.active ? TONE[x.taxType] : "grey",
        },
        ...(x.defaultTerms ? [{ label: x.defaultTerms, tone: "grey" as ChipTone }] : []),
        ...(isMissingBank && x.active ? [{ label: "No bank details", tone: "amber" as ChipTone }] : []),
        ...(!x.active ? [{ label: "Inactive", tone: "red" as ChipTone }] : []),
      ],
      meta: [
        { label: "TIN", value: x.tin ?? "—" },
        { label: "Terms", value: x.defaultTerms ?? "—" },
        {
          label: "Bank",
          value: isMissingBank
            ? "No bank details"
            : `UnionBank · ${x.bankAccountNumber ?? "Account set"}`,
        },
      ],
      amount: {
        label: "We owe",
        value: formatPeso(0),
        strong: true,
      },
      menuItems: [
        { label: "Open supplier", href: `/suppliers/${x.id}` },
        ...(can(user, "edit_data")
          ? [{ label: "Add contact", href: `/contacts/new?supplier=${x.id}` }]
          : []),
      ],
      sortValues: {
        name: x.name,
        tin: x.tin ?? "",
        tax: TAX_TYPE_LABELS[x.taxType],
        terms: x.defaultTerms ?? "",
        owe: 0,
      },
    };
  });

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
          {s.view && <input type="hidden" name="view" value={s.view} />}
        </form>

        <PillTabs
          ariaLabel="Tax type filter"
          tabs={filterTabs}
          active={tax ?? "all"}
          size="sm"
        />

        <div className="right">
          <Link
            className={`filter-chip${showInactive ? " active" : ""}`}
            href={href(s, { inactive: showInactive ? undefined : "1" })}
            aria-pressed={showInactive}
          >
            {showInactive ? "Showing inactive" : "Show inactive"}
          </Link>
        </div>
      </div>

      <RecordList
        listKey="suppliers"
        label="Suppliers"
        items={items}
        emptyTitle={filtered ? "No matches" : "All clear here"}
        emptyLine={
          filtered
            ? "Try another name or TIN, or clear the filter."
            : "No suppliers yet. Add your first supplier."
        }
        sortColumns={[
          { key: "name", label: "Name" },
          { key: "tin", label: "TIN" },
          { key: "tax", label: "Tax type" },
          { key: "terms", label: "Terms" },
          { key: "owe", label: "We owe", numeric: true },
        ]}
        defaultSortKey="name"
      />
    </>
  );
}
