import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { listReceivingView } from "@/lib/purchasing/views";
import { DataTable } from "@/components/DataTable";
import { EmptyState, PageHeader, PrimaryCell } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";
import { day, PoStatusChip, QtyBar, qtyText } from "@/components/purchasing/PoParts";

// Receiving: for everyone who can view. Quantities only — no prices.
export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ q?: string; history?: string }> }) {
  const user = await requirePagePermission("view");
  const s = await searchParams;
  const history = s.history === "1";
  const rows = await listReceivingView({ q: s.q, history }, user);

  return (
    <>
      <PageHeader title="Receiving" subtitle="Supplier POs out for delivery. Open one to record what arrived." />
      <div className="toolbar">
        <form className="search-pill" action="/receiving" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by PO number or supplier
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search PO no. or supplier" />
          {history && <input type="hidden" name="history" value="1" />}
        </form>
        <Link className={`filter-chip${!history ? " active" : ""}`} href="/receiving">
          Awaiting delivery
        </Link>
        <Link className={`filter-chip${history ? " active" : ""}`} href="/receiving?history=1">
          Received
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState line={history ? "No received POs yet." : "Nothing is waiting to be received."} />
        </div>
      ) : (
        <DataTable
          label="POs to receive"
          columns={[
            { key: "number", label: "PO no." },
            { key: "supplier", label: "Supplier" },
            { key: "so", label: "Sales order" },
            { key: "progress", label: "Received" },
            { key: "status", label: "Status" },
            { key: "expected", label: "Expected" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            href: `/receiving/${r.id}`,
            cells: {
              number: <span className="strong">{r.number}</span>,
              supplier: <PrimaryCell name={r.supplier.name} />,
              so: r.salesOrderNumber ?? <span className="faint">Standalone</span>,
              progress: (
                <div style={{ minWidth: 120 }}>
                  <div className="small">
                    {qtyText(r.receivedQty)} of {qtyText(r.orderedQty)} · {r.lineCount} line{r.lineCount === 1 ? "" : "s"}
                  </div>
                  <QtyBar received={r.receivedQty} ordered={r.orderedQty} label={`${r.number} received`} />
                </div>
              ),
              status: <PoStatusChip status={r.status} />,
              expected: day(r.expectedDate),
            },
            sort: { number: r.number, supplier: r.supplier.name, so: r.salesOrderNumber ?? "", progress: Number(r.receivedQty) / Math.max(1, Number(r.orderedQty)), status: r.status, expected: r.expectedDate ?? "" },
          }))}
        />
      )}
    </>
  );
}
