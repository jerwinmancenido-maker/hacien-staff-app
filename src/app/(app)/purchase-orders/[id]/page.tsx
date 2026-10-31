import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getPurchaseOrderView } from "@/lib/purchasing/views";
import { LINE_FLAG_LABELS, priceDifferenceText } from "@/lib/purchasing/match";
import { formatDateTime, formatPeso } from "@/lib/format";
import { Activity } from "@/components/Activity";
import { PillTabs } from "@/components/PillTabs";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { PoActions } from "@/components/purchasing/PoActions";
import { VoidButton } from "@/components/purchasing/DocButtons";
import { AttachmentLinks, BillStatusChip, day, MatchChip, PoStatusChip, QtyBar, qtyText } from "@/components/purchasing/PoParts";
import { RrTable } from "@/components/purchasing/RrTable";
import { voidReceivingReportAction } from "../../receiving/actions";
import {
  approvePurchaseOrderAction,
  closePurchaseOrderAction,
  emailPurchaseOrderAction,
  markPurchaseOrderSentAction,
  voidBillAction,
  voidPurchaseOrderAction,
} from "../actions";

const TABS = ["overview", "receiving", "bills", "match"] as const;
type Tab = (typeof TABS)[number];

export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  // Cost data: only users with "Can see costs" (others → /no-access).
  const user = await requireCostPage("view");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const po = await getPurchaseOrderView(id, user);
  if (!po) notFound();
  const canEdit = can(user, "edit_data");
  const canApprove = can(user, "approve") && po.approval.canApprove;
  const base = `/purchase-orders/${id}`;
  const liveBills = po.bills.filter((b) => b.status !== "VOID");
  const m = po.match;

  return (
    <>
      <PageHeader
        title={
          <>
            {po.number}
            {po.revision > 1 && <span className="muted small"> rev. {po.revision}</span>}
            <PoStatusChip status={po.status} />
          </>
        }
        subtitle={`${po.supplier.name} · ${po.salesOrder ? `For ${po.salesOrder.number} (${po.salesOrder.customer.name})` : "Standalone PO"}`}
        actions={
          <PoActions
            id={po.id}
            number={po.number}
            status={po.status}
            canEdit={canEdit}
            canApprove={canApprove}
            approveBlockedReason={can(user, "approve") ? po.approval.blockedReason : po.status === "DRAFT" ? "Waiting for an approver." : null}
            postedReceipts={po.postedReceipts}
            actions={{
              approve: approvePurchaseOrderAction,
              markSent: markPurchaseOrderSentAction,
              close: closePurchaseOrderAction,
              void: voidPurchaseOrderAction,
              email: emailPurchaseOrderAction,
            }}
          />
        }
      />
      {po.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {po.voidReason}
        </div>
      )}
      {po.status === "CLOSED" && po.closeReason && (
        <div className="alert warn" role="status">
          <b>Short-closed.</b> {po.closeReason}
        </div>
      )}

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: base },
          { key: "receiving", label: "Receiving", count: po.receivingReports.filter((r) => r.status === "POSTED").length, href: `${base}?tab=receiving` },
          { key: "bills", label: "Bills", count: liveBills.length, href: `${base}?tab=bills` },
          {
            key: "match",
            label: "Match",
            dot: m.status === "MISMATCH" ? (m.lines.some((l) => l.status === "PRICE_MISMATCH") ? "red" : "amber") : m.status === "MATCHED" ? "green" : undefined,
            href: `${base}?tab=match`,
          },
        ]}
      />

      {tab === "overview" && (
        <>
          <div className="detail-grid">
            <div className="card">
              <dl className="kv kv-grid">
                <dt>Supplier</dt>
                <dd>
                  <Link href={`/suppliers/${po.supplier.id}`}>{po.supplier.name}</Link>
                  {po.supplier.tin && <span className="muted small"> · TIN {po.supplier.tin}</span>}
                </dd>
                <dt>Contact</dt>
                <dd>{po.supplierContact ? `${po.supplierContact.name}${po.supplierContact.email ? ` · ${po.supplierContact.email}` : ""}` : "—"}</dd>
                <dt>Supplier address</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{po.supplierAddressText ?? "—"}</dd>
                <dt>Sales order</dt>
                <dd>{po.salesOrder ? <Link href={`/sales-orders/${po.salesOrder.id}`}>{po.salesOrder.number}</Link> : "Standalone"}</dd>
                <dt>PO date</dt>
                <dd>{day(po.date)}</dd>
                <dt>Expected delivery</dt>
                <dd>{day(po.expectedDate)}</dd>
                <dt>Deliver to</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{po.deliveryAddressText ?? "—"}</dd>
                <dt>Terms</dt>
                <dd>{po.terms ?? "—"}</dd>
                <dt>Approval</dt>
                <dd>
                  {po.approvedBy ? (
                    <>
                      Approved by {po.approvedBy}
                      {po.approvedAt ? ` · ${formatDateTime(po.approvedAt)}` : ""}
                    </>
                  ) : po.status === "DRAFT" ? (
                    <Chip tone="amber">Needs approval</Chip>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>Created by</dt>
                <dd>{po.createdBy}</dd>
                {po.notes && (
                  <>
                    <dt>Notes</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{po.notes}</dd>
                  </>
                )}
              </dl>
            </div>
            <Activity
              targets={[
                { entityType: "PurchaseOrder", ids: [po.id] },
                { entityType: "ReceivingReport", ids: po.receivingReports.map((r) => r.id) },
                { entityType: "SupplierBill", ids: po.bills.map((b) => b.id) },
              ]}
              viewer={user}
            />
          </div>
          <div className="card">
            <h2>Items</h2>
            <div className="table-wrap items-table">
              <table className="list" aria-label="PO items">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit cost</th>
                    <th className="num">Total</th>
                    <th className="num">Received</th>
                    <th aria-label="Progress" />
                  </tr>
                </thead>
                <tbody>
                  {po.items.map((i, n) => (
                    <tr key={i.id}>
                      <td className="faint">{n + 1}</td>
                      <td>
                        <div className="strong" style={{ whiteSpace: "pre-wrap" }}>
                          {i.description}
                        </div>
                        {i.qtyWarning && (
                          <div className="small warn-text" role="note">
                            ⚠ {i.qtyWarning} (SO qty {qtyText(i.soQty!)})
                          </div>
                        )}
                      </td>
                      <td className="num">{qtyText(i.qty)}</td>
                      <td>{i.unit}</td>
                      <td className="num">{formatPeso(i.unitCost)}</td>
                      <td className="num strong">{formatPeso(i.total)}</td>
                      <td className="num">
                        {qtyText(i.receivedQty)} / {qtyText(i.qty)}
                      </td>
                      <td style={{ minWidth: 90 }}>
                        <QtyBar received={i.receivedQty} ordered={i.qty} label={`Received ${qtyText(i.receivedQty)} of ${qtyText(i.qty)}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="totals-wrap">
              <div className="totals-box" aria-label="Totals">
                <div className="totals-row strong">
                  <span>PO total</span>
                  <span className="num">{formatPeso(po.subtotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "receiving" && (
        <div className="card">
          <div className="card-head">
            <h2>Receiving reports</h2>
            <div className="right">
              {canEdit && (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && (
                <Link className="btn btn-sm" href={`/receiving/${id}/new`}>
                  Receive items
                </Link>
              )}
            </div>
          </div>
          {po.receivingReports.length === 0 ? (
            <EmptyState line={po.status === "DRAFT" || po.status === "APPROVED" ? "Items can be received once the PO is sent." : "Nothing received yet."} />
          ) : (
            <RrTable reports={po.receivingReports} poId={id} canEdit={canEdit && po.status !== "CLOSED"} voidAction={voidReceivingReportAction} />
          )}
        </div>
      )}

      {tab === "bills" && (
        <div className="card">
          <div className="card-head">
            <h2>Supplier bills</h2>
            <div className="right">
              {canEdit && ["SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(po.status) && (
                <Link className="btn btn-sm" href={`${base}/bill`}>
                  Record bill
                </Link>
              )}
            </div>
          </div>
          {po.bills.length === 0 ? (
            <EmptyState line="No bills recorded yet." />
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Supplier bills">
                <thead>
                  <tr>
                    <th>Bill no.</th>
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Lines</th>
                    <th>Payments</th>
                    <th>Files</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {po.bills.map((b) => (
                    <tr key={b.id} className={b.status === "VOID" ? "inactive" : undefined}>
                      <td className="strong">{b.billNumber}</td>
                      <td>{day(b.billDate)}</td>
                      <td className="num strong">{formatPeso(b.amount)}</td>
                      <td className="small">
                        {b.items.length
                          ? b.items.map((x, n) => (
                              <div key={n}>
                                {x.description.split("\n")[0]}: {qtyText(x.qty)} × {formatPeso(x.unitPrice)}
                              </div>
                            ))
                          : "Total only"}
                        {b.voidReason && <div className="faint">Void: {b.voidReason}</div>}
                      </td>
                      <td className="small">
                        {b.payments.length === 0 ? (
                          <span className="faint">—</span>
                        ) : (
                          b.payments.map((p) => (
                            <div key={p.id}>
                              <Link href={`/payables/payments/${p.id}`}>{p.number}</Link>
                              <span className="faint"> · {formatPeso(p.cashApplied)}</span>
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        <AttachmentLinks files={b.attachments} />
                      </td>
                      <td>
                        <BillStatusChip status={b.status} />
                      </td>
                      <td>
                        {canEdit && b.status !== "VOID" && b.status !== "PAID" && b.status !== "PARTIALLY_PAID" && (
                          <VoidButton label="Void" docLabel="bill" body={`Bill ${b.billNumber} will be marked Void. Its number can be used again.`} onVoid={voidBillAction.bind(null, id, b.id)} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="faint small" style={{ marginTop: 12 }}>
            Payments are recorded under{" "}
            <Link href={`/suppliers/${po.supplier.id}?tab=payments`}>the supplier</Link> or{" "}
            <Link href="/payables/payments">Payables → Payments</Link>.
          </p>
        </div>
      )}

      {tab === "match" && (
        <div className="card">
          <div className="card-head">
            <h2>3-way match</h2>
            <div className="right">
              {m.status === "NOT_BILLED" ? <Chip>Not billed yet</Chip> : m.status === "MATCHED" ? <Chip tone="green">Matched</Chip> : <Chip tone="red">Mismatch</Chip>}
            </div>
          </div>
          {m.headerFlags.length > 0 && (
            <div className="alert warn" role="status">
              {m.headerFlags.map((f, n) => (
                <div key={n}>⚠ {f.message.replace(/(-?\d+\.\d{2})/g, (v) => formatPeso(v))}</div>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table className="list match-table" aria-label="3-way match">
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="num">Ordered × PO cost</th>
                  <th className="num">Received</th>
                  <th className="num">Billed × billed price</th>
                  <th>Flags</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((l) => {
                  const priceText = priceDifferenceText(l);
                  return (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: "pre-wrap" }}>{l.description}</td>
                      <td className="num">
                        {qtyText(l.orderedQty)} × {formatPeso(l.unitCost)}
                        <div className="small muted">{formatPeso(l.orderedAmount)}</div>
                      </td>
                      <td className="num">
                        {qtyText(l.receivedQty)} {l.unit}
                        <div className="small muted">{formatPeso(l.receivedAmount)}</div>
                      </td>
                      <td className="num">
                        {l.billedUnitPrice ? `${qtyText(l.billedQty)} × ${formatPeso(l.billedUnitPrice)}` : "—"}
                        <div className="small muted">{formatPeso(l.billedAmount)}</div>
                      </td>
                      <td className="small">
                        {l.flags.length === 0 && <span className="faint">—</span>}
                        {l.flags.map((f) => (
                          <div key={f}>
                            {LINE_FLAG_LABELS[f]}
                            {f === "PRICE_DIFFERS" && priceText && (
                              <>
                                {" "}
                                <b>({priceText.perUnit})</b>
                                <div className="muted">{priceText.lineTotal}</div>
                              </>
                            )}
                          </div>
                        ))}
                      </td>
                      <td>
                        {l.issues.length === 0 ? (
                          <MatchChip status="MATCHED" />
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {l.issues.map((i) => (
                              <MatchChip key={i} status={i} />
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Totals</th>
                  <th className="num">{formatPeso(m.orderedTotal)}</th>
                  <th className="num">{formatPeso(m.receivedTotal)}</th>
                  <th className="num">
                    {formatPeso(m.billedTotal)}
                    <div className="small muted">bill amounts</div>
                  </th>
                  <th colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
