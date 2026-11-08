import Link from "next/link";
import { formatPeso } from "@/lib/format";
import { groupItemDocuments, groupItemHistory, listItemDetailEntries, listSupplierPriceComparison } from "@/lib/items/history";
import type { ItemTab } from "@/lib/items/tabs";

/** Document type label for the where-used list. */
const DOC_LABELS = { quote: "Quotation", sales_order: "Sales order", purchase_order: "Purchase order" } as const;

function docHref(kind: "quote" | "sales_order" | "purchase_order", id: string): string {
  return kind === "quote" ? `/quotes/${id}` : kind === "sales_order" ? `/sales-orders/${id}` : `/purchase-orders/${id}`;
}

/** Tab badge counts for the item detail pages: priced lines, documents the
 * item appears on, and supplier rows (only counted when costs are visible). */
export async function itemTabCounts(
  description: string,
  showCosts: boolean,
): Promise<{ prices: number; used: number; suppliers: number }> {
  const entries = await listItemDetailEntries(description);
  const suppliers = showCosts ? await listSupplierPriceComparison(description) : [];
  return {
    prices: entries.filter((e) => e.price != null).length,
    used: groupItemDocuments(entries).length,
    suppliers: suppliers.length,
  };
}

/**
 * Step 2: the shared item detail — last price and last cost, full price
 * history (which quotes/SOs), supplier comparison (which POs, cheapest
 * first) and where-used. Used by the catalog item page (/items/[id]) and
 * the history-only detail (/items/history?item=...). Costs show only when
 * showCosts (the "Can see costs" role); prices and document links show to
 * every viewer, as on the Items page.
 *
 * Tabs (2026-11-08): the sections render one per tab (`section`), and each
 * tab loads only its own data, so a long history no longer stretches the
 * page. Section markup is unchanged from the stacked layout.
 */
export default async function ItemHistoryDetail({
  description,
  showCosts,
  section,
}: {
  description: string;
  showCosts: boolean;
  section: ItemTab;
}) {
  if (section === "prices") {
    const entries = await listItemDetailEntries(description);
    const priceEntries = entries.filter((e) => e.price != null);
    return (
      <div className="item-detail">
        <section aria-label="Price history">
          <h2>Price history</h2>
          {priceEntries.length === 0 ? (
            <p className="faint">No quote or sales order has priced this item yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Price history">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Document</th>
                    <th className="num">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {priceEntries.map((e, i) => (
                    <tr key={`${e.docKind}:${e.docId}:${i}`}>
                      <td>{e.date}</td>
                      <td>
                        <Link href={docHref(e.docKind, e.docId)}>{e.ref}</Link>
                        <div className="small faint">{DOC_LABELS[e.docKind]}</div>
                      </td>
                      <td className="num">{formatPeso(e.price ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  if (section === "suppliers") {
    if (!showCosts) return null;
    const suppliers = await listSupplierPriceComparison(description);
    return (
      <div className="item-detail">
        <section aria-label="Supplier comparison">
          <h2>Supplier comparison</h2>
          {suppliers.length === 0 ? (
            <p className="faint">No supplier PO price found for this item.</p>
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
                  {suppliers.map((row, i) => (
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
        </section>
      </div>
    );
  }

  if (section === "used") {
    const entries = await listItemDetailEntries(description);
    const docs = groupItemDocuments(entries);
    return (
      <div className="item-detail">
        <section aria-label="Where used">
          <h2>Where used</h2>
          {docs.length === 0 ? (
            <p className="faint">This item has not been used on any document yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Where used">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Document</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={`${d.docKind}:${d.docId}`}>
                      <td>{d.date}</td>
                      <td>
                        <Link href={docHref(d.docKind, d.docId)}>{d.docNumber}</Link>
                      </td>
                      <td>{DOC_LABELS[d.docKind]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  // details: last price and cost only.
  const entries = await listItemDetailEntries(description);
  const rows = groupItemHistory(entries);
  const last = rows[0];
  return (
    <div className="item-detail">
      <section aria-label="Last price and cost">
        <h2>Last price and cost</h2>
        {last == null ? (
          <p className="faint">No document lines for this item yet — it appears here once a quote, sales order or PO has a line.</p>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Last price</th>
                  {showCosts ? <th className="num">Last cost</th> : null}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {last.lastPrice != null ? (
                      <>
                        {formatPeso(last.lastPrice)}
                        <div className="small faint">
                          {last.lastPriceRef} · {last.lastPriceDate}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {showCosts ? (
                    <td className="num">
                      {last.lastCost != null ? (
                        <>
                          {formatPeso(last.lastCost)}
                          <div className="small faint">
                            {last.lastCostRef} · {last.lastCostDate}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  ) : null}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
