import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { listItemHistory } from "@/lib/items/history";
import { isItemsImportEnabled } from "@/lib/items/import-enabled";
import { listItems } from "@/lib/services/items";
import { ITEM_KIND_LABELS } from "@/lib/validation/items";
import { formatPeso } from "@/lib/format";
import { Chip, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { PillTabs } from "@/components/PillTabs";
import { SearchIcon } from "@/components/Icons";

/**
 * S-55: item list with last cost and price, from document lines.
 * Catalog (Step 1): the master list staff maintain once and reuse.
 * Step 2: history rows link to the history-only detail page.
 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cq?: string; tab?: string; showInactive?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { q, cq, tab, showInactive } = await searchParams;
  const activeTab = tab === "history" ? "history" : "catalog";
  const showCosts = canSeeCosts(user);
  const canEdit = can(user, "edit_data");

  const rows = activeTab === "history" ? await listItemHistory({ q }) : [];
  // Inactive items stay hidden by default (they can still be picked up again
  // via "Show inactive" — otherwise an inactive item could never be found
  // to reactivate it).
  const includeInactive = showInactive === "1";
  const items = activeTab === "catalog" ? await listItems({ q: cq, includeInactive }) : [];
  // Phase 4 #4: "Import CSV" sits in the catalog action slot, flag-gated only.
  const importEnabled = activeTab === "catalog" && canEdit ? await isItemsImportEnabled() : false;

  return (
    <>
      <PageHeader
        title="Items"
        subtitle={
          activeTab === "catalog"
            ? "Products staff quote — record each one once, with brand, model and price."
            : "Last price and last cost per item, from quotes, sales orders and supplier POs."
        }
        actions={
          activeTab === "catalog" && canEdit ? (
            <>
              {importEnabled ? (
                <Link className="btn secondary" href="/items/import">
                  Import CSV
                </Link>
              ) : null}{" "}
              <Link className="btn" href="/items/new">
                + New item
              </Link>
            </>
          ) : undefined
        }
      />
      <PillTabs
        active={activeTab}
        tabs={[
          { key: "catalog", label: "Catalog", href: "/items" },
          { key: "history", label: "From document lines", href: "/items?tab=history" },
        ]}
      />
      {activeTab === "catalog" ? (
        <>
          <form className="toolbar" method="get" role="search">
            <label className="sr-only" htmlFor="cq">
              Search catalog
            </label>
            <span className="search-box">
              <SearchIcon />
              <input id="cq" name="cq" type="search" defaultValue={cq ?? ""} placeholder="Search name, brand, model, SKU" />
            </span>
            <button className="btn secondary" type="submit">
              Search
            </button>
            <label className="check">
              <input type="checkbox" name="showInactive" value="1" defaultChecked={includeInactive} /> Show inactive
            </label>
            {cq ? (
              <Link className="btn secondary" href="/items">
                Clear
              </Link>
            ) : null}
          </form>
          {items.length === 0 ? (
            <p className="faint">
              No items in the catalog{cq ? ` for “${cq}”.` : " yet — add the first one with + New item."}
            </p>
          ) : (
            <DataTable
              label="Item catalog"
              columns={[
                { key: "item", label: "Item", sortable: false },
                { key: "brand", label: "Brand / Model", sortable: false },
                { key: "category", label: "Category", sortable: false },
                { key: "sku", label: "SKU", sortable: false },
                { key: "unit", label: "Unit", sortable: false },
                { key: "price", label: "Default price", numeric: true, sortable: false },
              ]}
              rows={items.map((item) => ({
                id: item.id,
                // Whole row opens the item, like every other list in the app
                // (owner ask 2026-11-09: the catalog rows felt unclickable —
                // only the name was a link and nothing looked clickable).
                href: `/items/${item.id}`,
                inactive: !item.active,
                cells: {
                  item: (
                    <>
                      <Link href={`/items/${item.id}`}>{item.name}</Link>
                      {!item.active && (
                        <>
                          {" "}
                          <Chip tone="red">Inactive</Chip>
                        </>
                      )}
                      {item.details ? <div className="small faint">{item.details}</div> : null}
                    </>
                  ),
                  brand: (
                    <>
                      {[item.brand, item.model].filter(Boolean).join(" · ") || "—"}
                      <div className="small faint">{ITEM_KIND_LABELS[item.kind]}</div>
                    </>
                  ),
                  category: item.category || "—",
                  sku: item.sku || "—",
                  unit: item.unit,
                  price: item.defaultUnitPrice != null ? formatPeso(item.defaultUnitPrice) : "—",
                },
              }))}
            />
          )}
        </>
      ) : (
        <>
          <form className="toolbar" method="get" role="search">
            <input type="hidden" name="tab" value="history" />
            <label className="sr-only" htmlFor="q">
              Search items
            </label>
            <span className="search-box">
              <SearchIcon />
              <input id="q" name="q" type="search" defaultValue={q ?? ""} placeholder="Search item description" />
            </span>
            <button className="btn secondary" type="submit">
              Search
            </button>
            {q ? (
              <Link className="btn secondary" href="/items?tab=history">
                Clear
              </Link>
            ) : null}
          </form>
          {rows.length === 0 ? (
            <p className="faint">No items found{q ? ` for “${q}”.` : " yet — items appear here once a quote, sales order or PO has a line."}</p>
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Items with last price and cost">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Last price</th>
                    {showCosts ? <th /> : null}
                    {showCosts ? <th className="num">Last cost</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <Link href={`/items/history?item=${encodeURIComponent(row.description)}`}>{row.description}</Link>
                        {showCosts ? (
                          <div className="small">
                            <Link href={`/items/compare?item=${encodeURIComponent(row.description)}`}>Compare suppliers →</Link>
                          </div>
                        ) : null}
                      </td>
                      <td className="num">
                        {row.lastPrice != null ? (
                          <>
                            {formatPeso(row.lastPrice)}
                            <div className="small faint">
                              {row.lastPriceRef} · {row.lastPriceDate}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      {showCosts ? (
                        <td className="num">
                          {row.lastCost != null ? (
                            <>
                              {formatPeso(row.lastCost)}
                              <div className="small faint">
                                {row.lastCostRef} · {row.lastCostDate}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
