import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import { listItemHistory } from "@/lib/items/history";
import { formatPeso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";

/** S-55: item list with last cost and price, from document lines. */
export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePagePermission("view");
  const { q } = await searchParams;
  const rows = await listItemHistory({ q });
  const showCosts = canSeeCosts(user);

  return (
    <>
      <PageHeader
        title="Items"
        subtitle="Last price and last cost per item, from quotes, sales orders and supplier POs. Descriptions come from document lines — there is no separate item list to maintain."
      />
      <form className="toolbar" method="get" role="search">
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
          <Link className="btn secondary" href="/items">
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
                {showCosts ? <th className="num">Last cost</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.description}</td>
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
  );
}
