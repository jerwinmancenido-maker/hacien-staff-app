import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { money } from "@/lib/documents/common";
import { listDispatchQueue } from "@/lib/sales-orders/dispatch";
import { PageHeader } from "@/components/ui";

/** Quantities print whole when they are whole ("2 pc", not "2.00 pc") —
 * the same strip the packing list applies. */
const qtyText = (qty: string, unit: string) => `${money(qty).replace(/\.00$/, "")} ${unit}`;

export default async function DispatchQueuePage() {
  await requirePagePermission("view");
  const summary = await listDispatchQueue();
  const oldest = summary.rows[0];

  return (
    <>
      <PageHeader
        title="Dispatch queue"
        subtitle="Open sales orders with goods still to deliver, oldest first. Own-company orders only."
      />
      <div className="toolbar">
        <Link className="filter-chip" href="/sales-orders">
          ← All sales orders
        </Link>
      </div>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Orders to dispatch</div>
          <div className="value num">{summary.orderCount}</div>
        </div>
        <div className="card stat">
          <div className="label">Total units remaining</div>
          <div className="value num">{money(summary.totalUnitsRemaining).replace(/\.00$/, "")}</div>
        </div>
        <div className={`card stat${oldest && oldest.daysOpen > 30 ? " stat-red" : ""}`}>
          <div className="label">Oldest wait</div>
          <div className="value num">{oldest ? `${oldest.daysOpen} day${oldest.daysOpen === 1 ? "" : "s"}` : "—"}</div>
        </div>
      </div>
      {summary.orderCount === 0 ? (
        <div className="card">
          <p className="faint" style={{ margin: 0 }}>
            Nothing to dispatch. Every open sales order is fully delivered.
          </p>
        </div>
      ) : (
        summary.rows.map((r) => (
          <div className="card" key={r.id} style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0 }}>
              <Link href={`/sales-orders/${r.id}`}>{r.number}</Link> · {r.customerName}
            </h2>
            <p className="small faint" style={{ marginTop: 0 }}>
              Ordered {formatDate(new Date(`${r.date}T00:00:00.000Z`))} · {r.daysOpen} day{r.daysOpen === 1 ? "" : "s"} open
              {r.contactName ? ` · Contact: ${r.contactName}${r.contactPhone ? ` · ${r.contactPhone}` : ""}` : ""}
            </p>
            {r.deliveryAddress ? (
              <p className="small" style={{ marginTop: 0 }}>
                Deliver to: {r.deliveryAddress}
              </p>
            ) : null}
            <div className="table-wrap">
              <table className="list" aria-label={`Items still to deliver for ${r.number}`}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.description}</td>
                      <td className="num strong">{qtyText(l.qtyRemaining, l.unit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="strong">Total remaining</td>
                    <td className="num strong">{money(r.unitsRemaining).replace(/\.00$/, "")}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
    </>
  );
}
