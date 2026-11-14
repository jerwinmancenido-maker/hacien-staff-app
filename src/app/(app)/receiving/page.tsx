import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { listReceivingView, listWarrantiesEndingSoon, listWarrantyClaims } from "@/lib/purchasing/views";
import { isWarrantyClaimsEnabled } from "@/lib/purchasing/warranty-claims";
import { WARRANTY_CLAIM_STATUS_LABELS, type WarrantyClaimStatus } from "@/lib/purchasing/warranty-claims-shared";
import { DataTable } from "@/components/DataTable";
import { EmptyState, PageHeader, PrimaryCell } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";
import { day, PoStatusChip, QtyBar, qtyText } from "@/components/purchasing/PoParts";

// Receiving: for everyone who can view. Quantities only — no prices.
export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; history?: string; warranty?: string; claims?: string }>;
}) {
  const user = await requirePagePermission("view");
  const s = await searchParams;
  const warrantySoon = s.warranty === "soon";
  const claimsEnabled = await isWarrantyClaimsEnabled();
  const claims = claimsEnabled && s.claims === "1";
  const history = !warrantySoon && !claims && s.history === "1";

  if (claims) {
    const rows = await listWarrantyClaims({ q: s.q });
    return (
      <>
        <PageHeader title="Receiving" subtitle="Supplier warranty claims filed from receiving lines." />
        <div className="toolbar">
          <form className="search-pill" action="/receiving" role="search">
            <SearchIcon />
            <label htmlFor="q" className="sr-only">
              Search claims by PO number, supplier, item, serial or fault
            </label>
            <input id="q" name="q" defaultValue={s.q} placeholder="Search claims" />
            <input type="hidden" name="claims" value="1" />
          </form>
          <Link className="filter-chip" href="/receiving">
            Awaiting delivery
          </Link>
          <Link className="filter-chip" href="/receiving?history=1">
            Received
          </Link>
          <Link className="filter-chip" href="/receiving?warranty=soon">
            Warranty ending soon
          </Link>
          <Link className="filter-chip active" href="/receiving?claims=1">
            Warranty claims
          </Link>
        </div>
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState line={s.q?.trim() ? `No warranty claims match "${s.q.trim()}".` : "No warranty claims filed yet. Open a received PO to file one."} />
          </div>
        ) : (
          <DataTable
            label="Warranty claims"
            columns={[
              { key: "filed", label: "Filed" },
              { key: "item", label: "Item" },
              { key: "status", label: "Status" },
              { key: "number", label: "PO no." },
              { key: "supplier", label: "Supplier" },
            ]}
            rows={rows.map((r) => ({
              id: r.id,
              href: `/receiving/${r.purchaseOrderId}`,
              cells: {
                filed: <span className="strong">{day(r.createdAt)}</span>,
                item: (
                  <>
                    {r.itemDescription.split("\n")[0]}
                    <div className="small faint">
                      {r.fault}
                      {r.serialNumber ? ` · Serial: ${r.serialNumber}` : ""}
                    </div>
                  </>
                ),
                status: WARRANTY_CLAIM_STATUS_LABELS[r.status as WarrantyClaimStatus] ?? r.status,
                number: <span className="strong">{r.purchaseOrderNumber}</span>,
                supplier: <PrimaryCell name={r.supplierName} />,
              },
              sort: {
                filed: r.createdAt,
                item: r.itemDescription,
                status: r.status,
                number: r.purchaseOrderNumber,
                supplier: r.supplierName,
              },
            }))}
          />
        )}
      </>
    );
  }

  if (warrantySoon) {
    const rows = await listWarrantiesEndingSoon({ q: s.q });
    return (
      <>
        <PageHeader title="Receiving" subtitle="Supplier warranties ending in the next 30 days." />
        <div className="toolbar">
          <form className="search-pill" action="/receiving" role="search">
            <SearchIcon />
            <label htmlFor="q" className="sr-only">
              Search by PO number, supplier, or serial number
            </label>
            <input id="q" name="q" defaultValue={s.q} placeholder="Search PO no., supplier, or serial" />
            <input type="hidden" name="warranty" value="soon" />
          </form>
          <Link className="filter-chip" href="/receiving">
            Awaiting delivery
          </Link>
          <Link className="filter-chip" href="/receiving?history=1">
            Received
          </Link>
          <Link className="filter-chip active" href="/receiving?warranty=soon">
            Warranty ending soon
          </Link>
          {claimsEnabled && (
            <Link className="filter-chip" href="/receiving?claims=1">
              Warranty claims
            </Link>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              line={
                s.q?.trim()
                  ? `No warranties ending in the next 30 days match "${s.q.trim()}".`
                  : "No supplier warranties ending in the next 30 days."
              }
            />
          </div>
        ) : (
          <DataTable
            label="Warranties ending soon"
            columns={[
              { key: "ends", label: "Ends" },
              { key: "item", label: "Item" },
              { key: "serials", label: "Serials" },
              { key: "number", label: "PO no." },
              { key: "supplier", label: "Supplier" },
              { key: "so", label: "Sales order" },
            ]}
            rows={rows.map((r) => ({
              id: r.id,
              href: `/receiving/${r.purchaseOrderId}`,
              cells: {
                ends: <span className="strong">{day(r.warrantyEndDate)}</span>,
                item: r.itemDescription,
                serials: r.serialNumbers?.trim() ? r.serialNumbers : <span className="faint">—</span>,
                number: <span className="strong">{r.purchaseOrderNumber}</span>,
                supplier: <PrimaryCell name={r.supplierName} />,
                so: r.salesOrderNumber ?? <span className="faint">Standalone</span>,
              },
              sort: {
                ends: r.warrantyEndDate,
                item: r.itemDescription,
                serials: r.serialNumbers ?? "",
                number: r.purchaseOrderNumber,
                supplier: r.supplierName,
                so: r.salesOrderNumber ?? "",
              },
            }))}
          />
        )}
      </>
    );
  }

  const rows = await listReceivingView({ q: s.q, history }, user);

  return (
    <>
      <PageHeader title="Receiving" subtitle="Supplier POs out for delivery. Open one to record what arrived." />
      <div className="toolbar">
        <form className="search-pill" action="/receiving" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            Search by PO number, supplier, or serial number
          </label>
          <input id="q" name="q" defaultValue={s.q} placeholder="Search PO no., supplier, or serial" />
          {history && <input type="hidden" name="history" value="1" />}
        </form>
        <Link className={`filter-chip${!history ? " active" : ""}`} href="/receiving">
          Awaiting delivery
        </Link>
        <Link className={`filter-chip${history ? " active" : ""}`} href="/receiving?history=1">
          Received
        </Link>
        <Link className="filter-chip" href="/receiving?warranty=soon">
          Warranty ending soon
        </Link>
        {claimsEnabled && (
          <Link className="filter-chip" href="/receiving?claims=1">
            Warranty claims
          </Link>
        )}
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
