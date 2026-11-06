import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { listItemHistory } from "@/lib/items/history";
import { listItems } from "@/lib/services/items";
import { ITEM_KIND_LABELS } from "@/lib/validation/items";
import { formatPeso } from "@/lib/format";
import { Chip, PageHeader } from "@/components/ui";
import { PillTabs } from "@/components/PillTabs";
import { SearchIcon } from "@/components/Icons";

/**
 * S-55: item list with last cost and price, from document lines.
 * Catalog (Step 1): the master list staff maintain once and reuse.
 * History rows become links in Step 2, once the detail page shows them.
 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cq?: string; tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { q, cq, tab } = await searchParams;
  const activeTab = tab === "history" ? "history" : "catalog";
  const showCosts = canSeeCosts(user);
  const canEdit = can(user, "edit_data");

  const rows = activeTab === "history" ? await listItemHistory({ q }) : [];
  const items = activeTab === "catalog" ? await listItems({ q: cq, includeInactive: true }) : [];

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
            <Link className="btn" href="/items/new">
              + New item
            </Link>
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
            <div className="table-wrap">
              <table className="list" aria-label="Item catalog">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Brand / Model</th>
                    <th>Category</th>
                    <th>SKU</th>
                    <th>Unit</th>
                    <th className="num">Default price</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/items/${item.id}`}>{item.name}</Link>
                        {!item.active && (
                          <>
                            {" "}
                            <Chip tone="red">Inactive</Chip>
                          </>
                        )}
                        {item.details ? <div className="small faint">{item.details}</div> : null}
                      </td>
                      <td>
                        {[item.brand, item.model].filter(Boolean).join(" · ") || "—"}
                        <div className="small faint">{ITEM_KIND_LABELS[item.kind]}</div>
                      </td>
                      <td>{item.category || "—"}</td>
                      <td>{item.sku || "—"}</td>
                      <td>{item.unit}</td>
                      <td className="num">{item.defaultUnitPrice != null ? formatPeso(item.defaultUnitPrice) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                        {row.description}
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
