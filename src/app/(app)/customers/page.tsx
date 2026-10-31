import Link from "next/link";
import type { WithholdingType } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listCustomers } from "@/lib/services/companies";
import { expiryWarningDays, ownersWithExpiringDocuments } from "@/lib/services/business-documents";
import { formatAddress } from "@/lib/addresses/format";
import { WITHHOLDING_LABELS, WITHHOLDING_TYPES } from "@/lib/validation/companies";
import { formatPeso } from "@/lib/format";
import { RecordList, type RecordItem } from "@/components/RecordList";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader, type ChipTone } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/Icons";

const TONE: Record<WithholdingType, ChipTone> = {
  GOVERNMENT: "green",
  TOP_WITHHOLDING_AGENT: "amber",
  NONE: "grey",
};

type Search = { q?: string; wh?: string; inactive?: string; docs?: string; view?: string };

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
  const whNotSet = s.wh === "NOT_SET";
  const wh = WITHHOLDING_TYPES.includes(s.wh as WithholdingType) ? (s.wh as WithholdingType) : undefined;
  const showInactive = s.inactive === "1";
  const expiringOnly = s.docs === "expiring";
  const warnDays = await expiryWarningDays();
  const expiringIds = await ownersWithExpiringDocuments("customer", warnDays);
  const customers = await listCustomers({
    q: s.q,
    withholding: wh,
    withholdingPick: whNotSet ? "NOT_SET" : undefined,
    showInactive,
    ...(expiringOnly ? { onlyIds: expiringIds } : {}),
  });
  const filtered = !!(s.q || wh || whNotSet || expiringOnly);

  const filterTabs = [
    { key: "all", label: "All", href: href(s, { wh: undefined }) },
    ...WITHHOLDING_TYPES.map((t) => ({
      key: t,
      label: WITHHOLDING_LABELS[t],
      href: href(s, { wh: t }),
    })),
  ];

  const items: RecordItem[] = customers.map((c) => {
    const address = c.addresses[0] ? formatAddress(c.addresses[0]) : null;
    return {
    id: c.id,
    href: `/customers/${c.id}`,
    inactive: !c.active,
    avatarName: c.name,
    title: c.name,
    subtitle: c.tin ? (
      <span className="num" style={{ textAlign: "left" }}>
        {c.tin}
      </span>
    ) : c.active ? (
      address || "No address"
    ) : (
      "Inactive"
    ),
    chips: [
      {
        label: WITHHOLDING_LABELS[c.withholdingType],
        tone: c.active ? TONE[c.withholdingType] : "grey",
      },
      ...(c.defaultTerms ? [{ label: c.defaultTerms, tone: "grey" as ChipTone }] : []),
      ...(expiringIds.includes(c.id) ? [{ label: "Documents expiring", tone: "amber" as ChipTone }] : []),
      ...(!c.active ? [{ label: "Inactive", tone: "red" as ChipTone }] : []),
    ],
    meta: [
      { label: "TIN", value: c.tin ?? "—" },
      { label: "Terms", value: c.defaultTerms ?? "—" },
      { label: "Address", value: address ?? "—" },
    ],
    amount: {
      label: "Balance due",
      value: formatPeso(0),
      strong: true,
    },
    menuItems: [
      { label: "Open customer", href: `/customers/${c.id}` },
      ...(can(user, "edit_data")
        ? [{ label: "Add contact", href: `/contacts/new?customer=${c.id}` }]
        : []),
    ],
    sortValues: {
      name: c.name,
      tin: c.tin ?? "",
      wh: WITHHOLDING_LABELS[c.withholdingType],
      terms: c.defaultTerms ?? "",
      balance: 0,
    },
    };
  });

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
          {(wh || whNotSet) && <input type="hidden" name="wh" value={wh ?? "NOT_SET"} />}
          {showInactive && <input type="hidden" name="inactive" value="1" />}
          {expiringOnly && <input type="hidden" name="docs" value="expiring" />}
          {s.view && <input type="hidden" name="view" value={s.view} />}
        </form>

        <PillTabs
          ariaLabel="Withholding filter"
          tabs={filterTabs}
          active={whNotSet ? "NOT_SET" : (wh ?? "all")}
          size="sm"
        />

        <div className="right">
          <Link
            className={`filter-chip${expiringOnly ? " active" : ""}`}
            href={href(s, { docs: expiringOnly ? undefined : "expiring" })}
            aria-pressed={expiringOnly}
            title={`Documents expired or expiring within ${warnDays} days`}
          >
            Expiring documents{expiringIds.length ? ` (${expiringIds.length})` : ""}
          </Link>
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
        listKey="customers"
        label="Customers"
        items={items}
        emptyTitle={filtered ? "No matches" : "All clear here"}
        emptyLine={
          filtered
            ? "Try another name or TIN, or clear the filter."
            : "No customers yet. Add your first customer."
        }
        emptyAction={
          !filtered && can(user, "edit_data") ? (
            <Link className="btn btn-secondary" href="/customers/new">
              New customer
            </Link>
          ) : undefined
        }
        sortColumns={[
          { key: "name", label: "Name" },
          { key: "tin", label: "TIN" },
          { key: "terms", label: "Terms" },
          { key: "balance", label: "Balance", numeric: true },
        ]}
        defaultSortKey="name"
      />
    </>
  );
}
