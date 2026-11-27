import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { can } from "@/lib/permissions";
import {
  getStoreOrderConversionPrep,
  getStoreOrderDetail,
  listStoreOrderConversionOptions,
  storeOrderDisplayLabel,
} from "@/lib/store-orders/views";
import { getStoreOrderMirrorState } from "@/lib/store-orders/refund";
import { Chip, PageHeader } from "@/components/ui";
import { RecordBreadcrumbLabel } from "@/components/Sidebar";
import { ConvertStoreOrderButton } from "@/components/store-orders/ConvertStoreOrderDialog";
import { MarkProvisioningButton, RefundStoreOrderButtons } from "@/components/store-orders/StoreOrderMirrorActions";

export const dynamic = "force-dynamic";

const MATCH_LABELS = { MAPPED: "Mapped", NO_MATCH: "No match", AMBIGUOUS: "Ambiguous SKU" } as const;

/**
 * Store order detail (store intake Slice 1): everything staff need to see
 * before converting — buyer, delivery address, lines with their SKU match
 * flags, the gateway data (the fee is absorbed as an order expense at
 * conversion, never on a customer document), and the proposed match. The Convert action
 * (Slice 2) shows for approve-permission staff while the order is PAID.
 * After conversion, the refund / chargeback mirror (Slice 3) shows the
 * converted chain's void progress and its actions; PROVISIONING is a
 * plain staff-set state for subscription orders being fulfilled.
 */
export default async function StoreOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const order = await getStoreOrderDetail(id);
  if (!order) notFound();

  // Conversion (Slice 2) is approve-gated; the dialog data loads only for
  // staff who could actually convert, and only while the order is PAID.
  const canConvert = order.status === "PAID" && can(user, "approve");
  const [prep, options] = canConvert
    ? await Promise.all([getStoreOrderConversionPrep(order.id), listStoreOrderConversionOptions()])
    : [null, null];

  // Refund / chargeback mirror (Slice 3): progress is derived live from
  // the linked documents' statuses — there is no progress column.
  const mirror = order.salesOrderId ? await getStoreOrderMirrorState(order.id) : null;
  const canMirror = (order.status === "CONFIRMED" || order.status === "PROVISIONING") && can(user, "manage_billing");
  const canProvision = order.status === "CONFIRMED" && can(user, "edit_data");
  const isTerminal = order.status === "REFUNDED" || order.status === "CHARGEBACK";

  const addressLine = [order.addressStreet, order.addressBarangay, order.addressCityMunicipality, order.addressProvince, order.addressZip]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <RecordBreadcrumbLabel label={order.number} />
      <PageHeader
        title={order.number}
        subtitle={`Web order paid ${formatDateTime(order.paidAt)} via ${order.gatewayName}.`}
        actions={
          <>
            {prep && options && (
              <ConvertStoreOrderButton prep={prep} customers={options.customers} items={options.items} />
            )}
            <Chip tone={order.displayStatus === "PAID" ? "amber" : order.displayStatus === "DONE" ? "green" : "grey"}>
              {storeOrderDisplayLabel(order.displayStatus)}
            </Chip>
          </>
        }
      />

      <div className="card">
        <dl className="kv kv-grid">
          <dt>Buyer</dt>
          <dd>{order.buyerName}</dd>
          <dt>Email</dt>
          <dd>{order.buyerEmail}</dd>
          <dt>Phone</dt>
          <dd>{order.buyerPhone}</dd>
          <dt>Delivery address</dt>
          <dd>
            {order.addressLabel ? `${order.addressLabel} — ` : ""}
            {addressLine}
          </dd>
          {order.buyerNotes ? (
            <>
              <dt>Buyer notes</dt>
              <dd>{order.buyerNotes}</dd>
            </>
          ) : null}
          <dt>Customer match</dt>
          <dd>
            {order.matchedCustomer ? (
              <>
                Proposed: <Link href={`/customers/${order.matchedCustomer.id}`}>{order.matchedCustomer.name}</Link>
                {order.matchedContact ? ` (via ${order.matchedContact.name})` : ""} — staff confirm at conversion.
              </>
            ) : (
              "No match proposed — staff will pick or create the customer at conversion."
            )}
          </dd>
          {order.salesOrder ? (
            <>
              <dt>Sales order</dt>
              <dd>
                <Link href={`/sales-orders/${order.salesOrder.id}`}>{order.salesOrder.number}</Link> ({order.salesOrder.status})
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <h2>Lines</h2>
      <div className="table-wrap">
        <table className="list" aria-label="Store order lines">
          <thead>
            <tr>
              <th>Item</th>
              <th>SKU</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Total</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.title}
                  {l.item && l.item.name !== l.title ? <div className="small faint">Catalogue: {l.item.name}</div> : null}
                  {l.termEndDate ? <div className="small faint">Subscription until {formatDate(l.termEndDate)}</div> : null}
                </td>
                <td>{l.sku ?? "—"}</td>
                <td className="num">
                  {l.qty.toFixed(2)} {l.unit}
                </td>
                <td className="num">{formatPeso(l.unitPrice.toFixed(2))}</td>
                <td className="num">{formatPeso(l.lineTotal.toFixed(2))}</td>
                <td>
                  <Chip tone={l.matchFlag === "MAPPED" ? "green" : "amber"}>{MATCH_LABELS[l.matchFlag]}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <dl className="kv kv-grid">
          <dt>Amount paid</dt>
          <dd>{formatPeso(order.amountPaid.toFixed(2))}</dd>
          <dt>Delivery fee</dt>
          <dd>{formatPeso(order.deliveryFee.toFixed(2))}</dd>
          <dt>Gateway</dt>
          <dd>{order.gatewayName}</dd>
          <dt>Payment reference</dt>
          <dd>{order.gatewayPaymentRef}</dd>
          <dt>Gateway fee</dt>
          <dd>{formatPeso(order.gatewayFee.toFixed(2))} — absorbed by HACIEN: booked as an expense on the sales order at conversion; never on a customer document.</dd>
          <dt>Received</dt>
          <dd>{formatDateTime(order.createdAt)}</dd>
        </dl>
      </div>

      {mirror ? (
        <>
          <h2>Refund / chargeback</h2>
          <div className="card">
            <p className="small">
              {isTerminal
                ? `This order is marked ${order.status === "REFUNDED" ? "refunded" : "as a chargeback"} — every document in the converted chain is void. The linked documents below are the ones a chargeback evidence pack needs.`
                : "A refund or chargeback unwinds the converted documents in order — collection, billing, sales order, then the gateway fee expense — each voided by its own service with the same reason. Progress is read live from the documents; if the sequence stops, run it again to finish the remaining steps."}
            </p>
            <div className="table-wrap">
              <table className="list" aria-label="Refund mirror progress">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Number</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mirror.steps.map((s) => (
                    <tr key={`${s.key}-${s.docId}`}>
                      <td>{s.label}</td>
                      <td>
                        <Link href={s.href}>{s.docNumber}</Link>
                      </td>
                      <td>
                        <Chip tone={s.done ? "grey" : "amber"}>{s.done ? "Void" : "To void"}</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mirror.gatewayFee === "0.00" ? (
              <p className="small faint">No gateway fee expense — the gateway fee on this order was 0.00.</p>
            ) : null}
            {(canProvision || canMirror) && (
              <div style={{ marginTop: 12 }}>
                {canProvision && <MarkProvisioningButton orderId={order.id} />}{" "}
                {canMirror && (
                  <RefundStoreOrderButtons
                    orderId={order.id}
                    number={order.number}
                    gatewayName={order.gatewayName}
                    gatewayPaymentRef={order.gatewayPaymentRef}
                    pendingSteps={mirror.steps.filter((s) => !s.done).map((s) => `${s.label} ${s.docNumber}`)}
                  />
                )}
              </div>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
