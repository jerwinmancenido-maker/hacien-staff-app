import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canVoid } from "@/lib/permissions";
import { getSalesOrderView } from "@/lib/quotes/views";
import { getSoCostMargin, getSoPurchasing } from "@/lib/purchasing/views";
import { formatDate, formatPeso } from "@/lib/format";
import { listBillings, listSalesOrderCollections } from "@/lib/billing/views";
import { salesOrderMoney } from "@/lib/billing/status";
import { soBillingSummary } from "@/lib/services/billings";
import { toScaled } from "@/lib/quotes/calc";
import { Activity } from "@/components/Activity";
import { BillingStatusChip, OverdueBadge } from "@/components/billing/BillingParts";
import { PillTabs } from "@/components/PillTabs";
import { Chip, PageHeader } from "@/components/ui";
import { OVERRIDE_NOTE } from "@/lib/quotes/withholding-defaults";
import { ItemsTable, QuoteStatusChip, SoStatusChip, TotalsBox } from "@/components/docs/DocParts";
import { SalesOrderActions } from "@/components/docs/QuoteActions";
import { PoStatusChip, ProgressChip, QtyBar, qtyText } from "@/components/purchasing/PoParts";
import { SoCostMarginTab } from "@/components/purchasing/SoCostMarginTab";
import { GovernmentDealBox } from "@/components/sales-orders/GovernmentDealBox";
import { DeliverySection } from "@/components/sales-orders/DeliverySection";
import { AttachmentsTab } from "@/components/AttachmentsTab";
import { RemindMeForm } from "@/components/RemindMeForm";
import { createReminderAction } from "@/app/(app)/reminders/actions";
import { listSalesOrderDeliveries } from "@/lib/services/deliveries";
import { recordDeliveryAction, voidDeliveryAction, voidDeliveryForOrder, voidSalesOrderAction } from "../actions";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

const TABS = ["overview", "documents", "cost-margin", "attachments"] as const;
type Tab = (typeof TABS)[number];

export default async function SalesOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { created, tab: rawTab } = await searchParams;
  // Built on the server without cost fields for users who can't see costs.
  const so = await getSalesOrderView(id, user);
  if (!so) notFound();
  // PO numbers for everyone; links (and Create POs) only for cost users.
  const purchasing = await getSoPurchasing(so.id, user);
  const progress = new Map(purchasing.lines.map((l) => [l.id, l]));
  const canCreatePos = user.isAdmin && so.canSeeCosts && so.status === "OPEN" && so.quote.status === "WON" && purchasing.ordered < purchasing.total;
  const [billingSummary, billings, costMargin, deliveries, collections] = await Promise.all([
    soBillingSummary(so.id),
    listBillings({ salesOrderId: so.id }),
    so.canSeeCosts ? getSoCostMargin(so.id, user) : Promise.resolve(null),
    listSalesOrderDeliveries(so.id),
    listSalesOrderCollections(so.id),
  ]);
  const money = billingSummary
    ? salesOrderMoney(so.status, billingSummary.contractPrice, [
        {
          status: "OPEN",
          amount: billingSummary.billed,
          cashApplied: billingSummary.cashCollected,
          withholdingApplied: billingSummary.withholdingCollected,
        },
      ])
    : null;
  const canBill = can(user, "record_billing") && so.status === "OPEN" && money != null && toScaled(money.leftToBill, 2) > 0n;
  const overdueOnSo = billings.find((b) => b.overdue.overdue && !b.isGovernment);

  // Linked documents is for everyone; Cost & margin stays cost-users only.
  const tab: Tab =
    rawTab === "cost-margin" ? (so.canSeeCosts ? "cost-margin" : "overview") : TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const base = `/sales-orders/${id}`;
  const costWarnings = costMargin?.warnings.length ?? 0;

  return (
    <>
      <PageHeader
        title={
          <>
            {so.number}
            {money?.completed ? <Chip tone="grey">Completed</Chip> : <SoStatusChip status={so.status} />}
          </>
        }
        subtitle={
          <>
            {so.customer.name} · Buyer PO {so.buyerPoNo ?? "—"} {overdueOnSo && <OverdueBadge label={overdueOnSo.overdue.label} />}
          </>
        }
        actions={
          <SalesOrderActions id={so.id} number={so.number} status={so.status} canEdit={can(user, "edit_data")} canVoid={canVoid(user)} voidAction={voidSalesOrderAction} billings={billings.map((b) => ({ id: b.id, number: b.number }))} canBill={canBill} canCreatePos={canCreatePos} />
        }
      />
      {created && (
        <div className="alert ok" role="status">
          Created {created} draft PO{created === "1" ? "" : "s"}. They need approval before they&apos;re sent.
        </div>
      )}
      {so.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {so.voidReason}
        </div>
      )}

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: base },
          { key: "documents", label: "Linked documents", count: billings.length + collections.length + deliveries.length + 1, href: `${base}?tab=documents` },
          ...(so.canSeeCosts
            ? [
                {
                  key: "cost-margin",
                  label: "Cost & margin",
                  count: costWarnings ? undefined : costMargin?.rows.length,
                  chip: costWarnings ? `${costWarnings} warning${costWarnings === 1 ? "" : "s"}` : undefined,
                  chipTone: costWarnings ? "amber" : undefined,
                  href: `${base}?tab=cost-margin`,
                } as const,
              ]
            : []),
          {
            key: "attachments",
            label: "Attachments",
            count: deliveries.flatMap((d) => d.attachments).length,
            href: `${base}?tab=attachments`,
          },
        ]}
      />

      {tab === "cost-margin" && costMargin && <SoCostMarginTab summary={costMargin} />}

      {tab === "documents" && (
        <div className="card">
          <h2>Linked documents</h2>
          <p className="small muted">Source quote, billings, collections and delivery receipts for this order. POs, receiving and supplier bills stay in the Cost &amp; margin tab.</p>
          <div className="table-wrap">
            <table className="list" aria-label="Linked documents">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Number</th>
                  <th>Date</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Source quote</td>
                  <td className="strong">
                    <Link href={`/quotes/${so.quote.id}`}>{so.quote.number}</Link>
                  </td>
                  <td>{day(so.quote.date)}</td>
                  <td className="num">{formatPeso(so.quote.contractPrice)}</td>
                  <td>
                    <QuoteStatusChip status={so.quote.status} />
                  </td>
                  <td>
                    <Link href={`/quotes/${so.quote.id}`}>Open</Link>
                  </td>
                </tr>
                {billings.map((b) => (
                  <tr key={b.id}>
                    <td>Billing</td>
                    <td className="strong">
                      <Link href={`/billing/billings/${b.id}`}>{b.number}</Link>
                    </td>
                    <td>{day(b.invoiceDate)}</td>
                    <td className="num">{formatPeso(b.amount)}</td>
                    <td>
                      <BillingStatusChip status={b.status} />
                    </td>
                    <td>
                      <Link href={`/billing/billings/${b.id}`}>Open</Link> ·{" "}
                      <Link href={`/print/billings/${b.id}`} target="_blank" rel="noopener">
                        Print
                      </Link>
                    </td>
                  </tr>
                ))}
                {collections.map((c) => (
                  <tr key={c.id}>
                    <td>Collection</td>
                    <td className="strong">
                      <Link href={`/billing/collections/${c.id}`}>{c.number}</Link>
                    </td>
                    <td>{day(c.date)}</td>
                    <td className="num">{formatPeso(c.amountReceived)}</td>
                    <td>{c.status}</td>
                    <td>
                      <Link href={`/billing/collections/${c.id}`}>Open</Link>
                    </td>
                  </tr>
                ))}
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>Delivery receipt</td>
                    <td className="strong">{d.drNumber}</td>
                    <td>{day(d.deliveryDate ? new Date(d.deliveryDate).toISOString().slice(0, 10) : null)}</td>
                    <td className="num">—</td>
                    <td>{d.voidedAt ? "Void" : "Delivered"}</td>
                    <td>
                      <Link href={base}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "attachments" && (
        <AttachmentsTab sections={[{ label: "Deliveries", files: deliveries.flatMap((d) => d.attachments) }]} />
      )}

      {tab === "overview" && (
        <>
          <div className="detail-grid">
            <div>
              <div className="card">
                <dl className="kv kv-grid">
                  <dt>Customer</dt>
                  <dd>
                    <Link href={`/customers/${so.customer.id}`}>{so.customer.name}</Link>
                  </dd>
                  <dt>From quote</dt>
                  <dd>
                    <Link href={`/quotes/${so.quote.id}`}>{so.quote.number}</Link> <QuoteStatusChip status={so.quote.status} />
                  </dd>
                  <dt>Buyer PO no.</dt>
                  <dd>{so.buyerPoNo ?? "—"}</dd>
                  <dt>Buyer PO date</dt>
                  <dd>{day(so.buyerPoDate)}</dd>
                  <dt>SO date</dt>
                  <dd>{day(so.date)}</dd>
                  <dt>Tracking ref</dt>
                  <dd>{so.trackingRef ?? "—"}</dd>
                  <dt>Contact</dt>
                  <dd>{so.contact ? `${so.contact.name}${so.contact.email ? ` · ${so.contact.email}` : ""}` : "—"}</dd>
                  <dt>Delivery address</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{so.deliveryAddress ?? "—"}</dd>
                  <dt>Terms</dt>
                  <dd>{so.terms ?? "—"}</dd>
                  <dt>Withholding</dt>
                  <dd>{so.withholding.length ? so.withholding.map((w) => w.label).join(", ") : "None"}</dd>
                  {so.notes && (
                    <>
                      <dt>Notes</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>{so.notes}</dd>
                    </>
                  )}
                </dl>
              </div>
              {so.customer.withholdingType === "GOVERNMENT" && (
                <GovernmentDealBox so={so} canEdit={can(user, "edit_data")} />
              )}
            </div>
            <Activity targets={[{ entityType: "SalesOrder", ids: [so.id] }]} viewer={user} />
          </div>
          <div className="card">
            <h2>Items</h2>
            <ItemsTable
              items={so.items.map((i) => ({
                ...i,
                overrideNote: i.withholdingOverride ? OVERRIDE_NOTE : null,
              }))}
              showCosts={so.canSeeCosts}
            />
            <div className="totals-wrap">
              <TotalsBox totals={so.totals} showCosts={so.canSeeCosts} />
            </div>
          </div>
          {billingSummary && (
            <div className="card" aria-label="Billing">
              <div className="card-head">
                <h2>Billing</h2>
              </div>
              {money && (
                <dl className="kv kv-grid" aria-label="Sales order money">
                  <dt>Left to bill</dt>
                  <dd className="num">{formatPeso(money.leftToBill)}</dd>
                  <dt>Unpaid billed</dt>
                  <dd className="num">{formatPeso(money.unpaidBilled)}</dd>
                  <dt>Cash collected</dt>
                  <dd className="num">{formatPeso(money.cashCollected)}</dd>
                  <dt>2307 received</dt>
                  <dd className="num">{formatPeso(money.received2307)}</dd>
                  <dt>Total paid</dt>
                  <dd className="num strong">{formatPeso(money.totalPaid)}</dd>
                </dl>
              )}
              {billings.length === 0 ? (
                <p className="faint">No billings yet. Write the booklet invoice number you issued.</p>
              ) : (
                <>
                <div className="table-wrap so-bill-desk">
                  <table className="list" aria-label="Billings on this SO">
                    <thead>
                      <tr>
                        <th>Booklet</th>
                        <th>Internal</th>
                        <th>Date</th>
                        <th>Due</th>
                        <th className="num">Amount</th>
                        <th className="num">Balance</th>
                        <th>Status</th>
                        <th>Print</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billings.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <Link href={`/billing/billings/${b.id}`}>#{b.invoiceNo}</Link>
                          </td>
                          <td className="faint">{b.number}</td>
                          <td>{day(b.invoiceDate)}</td>
                          <td>{b.expectedPaymentLabel ? b.expectedPaymentLabel : day(b.dueDate)}</td>
                          <td className="num">{formatPeso(b.amount)}</td>
                          <td className="num">{formatPeso(b.balance)}</td>
                          <td>
                            <BillingStatusChip status={b.status} /> {!b.isGovernment && <OverdueBadge label={b.overdue.label} />}
                          </td>
                          <td>
                            <Link href={`/print/billings/${b.id}`} target="_blank" rel="noopener">
                              Print
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="so-bill-phone" aria-label="Billings on this SO">
                  {billings.map((b) => (
                    <li key={b.id}>
                      <Link href={`/billing/billings/${b.id}`}>#{b.invoiceNo}</Link>
                      <span>{day(b.invoiceDate)}</span>
                      <span>{b.expectedPaymentLabel ? b.expectedPaymentLabel : `Due ${day(b.dueDate)}`}</span>
                      <span className="num">{formatPeso(b.amount)}</span>
                      <Link href={`/print/billings/${b.id}`} target="_blank" rel="noopener">
                        Print
                      </Link>
                    </li>
                  ))}
                </ul>
                </>
              )}
            </div>
          )}
          <div className="card" aria-label="Purchasing">
            <div className="card-head">
              <h2>Purchasing progress</h2>
              <div className="right small muted">
                {purchasing.received} of {purchasing.total} received
                {so.canSeeCosts && (
                  <>
                    {" · "}
                    <Link className="btn-link small" href={`${base}?tab=cost-margin`}>
                      Cost &amp; margin →
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table className="list" aria-label="Purchasing progress">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>Supplier PO</th>
                    <th className="num">SO qty</th>
                    <th className="num">Ordered</th>
                    <th className="num">Received</th>
                    <th aria-label="Progress" />
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {so.items.map((i, n) => {
                    const p = progress.get(i.id);
                    if (!p) return null;
                    return (
                      <tr key={i.id}>
                        <td className="faint">{n + 1}</td>
                        <td style={{ whiteSpace: "pre-wrap" }}>{i.description.split("\n")[0]}</td>
                        <td>
                          {p.purchaseOrders.length === 0 && <span className="faint">—</span>}
                          {p.purchaseOrders.map((po) => (
                            <div key={po.number}>
                              {po.id ? <Link href={`/purchase-orders/${po.id}`}>{po.number}</Link> : po.number} <PoStatusChip status={po.status} />
                            </div>
                          ))}
                        </td>
                        <td className="num">
                          {qtyText(i.qty)} {i.unit}
                        </td>
                        <td className="num">{qtyText(p.ordered)}</td>
                        <td className="num">{qtyText(p.received)}</td>
                        <td style={{ minWidth: 80 }}>
                          <QtyBar received={p.received} ordered={i.qty} label={`Received ${qtyText(p.received)} of ${qtyText(i.qty)}`} />
                        </td>
                        <td>
                          <ProgressChip state={p.state} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <DeliverySection
            status={so.status}
            items={so.items.map((i) => ({
              id: i.id,
              description: i.description,
              unit: i.unit,
              qty: i.qty,
              deliveredQty: i.deliveredQty ?? "0.00",
            }))}
            deliveries={deliveries.map((d) => ({
              id: d.id,
              drNumber: d.drNumber,
              deliveryDate: d.deliveryDate,
              receivedBy: d.receivedBy,
              receivedDate: d.receivedDate,
              idSightChecked: d.idSightChecked,
              idCheckedBy: d.idCheckedBy,
              idCheckedAt: d.idCheckedAt,
              voidedAt: d.voidedAt,
              voidReason: d.voidReason,
              items: d.items.map((di) => ({
                id: di.id,
                salesOrderItemId: di.salesOrderItemId,
                qty: di.qty.toString(),
                serialNumbers: di.serialNumbers,
                salesOrderItem: di.salesOrderItem,
              })),
              attachments: d.attachments,
            }))}
            canEdit={can(user, "edit_data")}
            canVoid={canVoid(user)}
            action={recordDeliveryAction.bind(null, so.id)}
            voidAction={voidDeliveryForOrder.bind(null, so.id)}
          />
          {can(user, "edit_data") && <RemindMeForm entityType="SALES_ORDER" entityId={so.id} action={createReminderAction} />}
        </>
      )}
    </>
  );
}
