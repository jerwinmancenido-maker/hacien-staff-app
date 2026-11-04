import Link from "next/link";
import { requireCostPage } from "@/lib/auth/current-user";
import { listSupplierPriceComparison } from "@/lib/items/history";
import { formatPeso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";

/** S-56: supplier price compare — cheapest first, for one item description. Costs only. */
export default async function ItemComparePage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  await requireCostPage("view");
  const { item } = await searchParams;
  const rows = item ? await listSupplierPriceComparison(item) : [];

  return (
    <>
      <PageHeader
        title="Compare suppliers"
        subtitle="Last PO cost per supplier for one item, cheapest first. Matches the item description exactly."
      />
      <form className="toolbar" method="get" role="search">
        <label className="sr-only" htmlFor="item">
          Item description
        </label>
        <span className="search-box">
          <SearchIcon />
          <input id="item" name="item" type="search" defaultValue={item ?? ""} placeholder="Type the item description exactly" />
        </span>
        <button className="btn secondary" type="submit">
          Compare
        </button>
        <Link className="btn secondary" href="/items">
          Back to items
        </Link>
      </form>
      {!item ? (
        <p className="faint">Type an item description, or follow a Compare suppliers link from the Items page.</p>
      ) : rows.length === 0 ? (
        <p className="faint">No supplier PO price found for “{item}”.</p>
      ) : (
        <div className="table-wrap">
          <table className="list" aria-label="Supplier price comparison">
            <thead>
              <tr>
                <th>Supplier</th>
                <th className="num">Last cost</th>
                <th>PO</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.supplierId}>
                  <td>
                    <Link href={`/suppliers/${row.supplierId}`}>{row.supplierName}</Link>
                    {i === 0 ? <span className="small muted"> · Lowest</span> : null}
                  </td>
                  <td className="num">{formatPeso(row.lastCost)}</td>
                  <td>{row.poNumber}</td>
                  <td>{row.lastCostDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
