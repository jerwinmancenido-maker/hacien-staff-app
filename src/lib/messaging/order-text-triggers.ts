// Order-text trigger wiring (Q16, S-95). Called AFTER the main record's
// transaction commits, never inside it — so a text failure can never roll
// back an order, delivery or payment. Every helper swallows its own errors
// and returns null on any failure; sendOrderText itself never throws.

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { soDeliveryProgress } from "@/lib/sales-orders/delivery";
import { money } from "@/lib/documents/common";
import { sendOrderText, type OrderTextOutcome } from "./order-texts";

async function loadRecipient(salesOrderId: string) {
  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      customer: { include: { contacts: { where: { active: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] } } },
      contact: true,
    },
  });
  if (!so) return null;
  const main = so.customer.contacts.find((c) => c.isMain) ?? so.customer.contacts[0];
  const contact = so.contact ?? main ?? null;
  return {
    salesOrderId: so.id,
    salesOrderNumber: so.number,
    customerName: so.customer.name,
    orderTextUpdates: so.customer.orderTextUpdates,
    contactName: contact?.name ?? null,
    contactPhone: contact?.phone ?? main?.phone ?? null,
  };
}

/** Order confirmed: SO created from a quote. */
export async function notifyOrderConfirmed(salesOrderId: string, sentById?: string): Promise<OrderTextOutcome | null> {
  try {
    const recipient = await loadRecipient(salesOrderId);
    if (!recipient) return null;
    const { settings } = await getSettingsSnapshot();
    return await sendOrderText(
      {
        kind: "confirmed",
        salesOrderNumber: recipient.salesOrderNumber,
        salesOrderId: recipient.salesOrderId,
        sourceId: recipient.salesOrderId,
        recipient,
        sentById,
      },
      { settings: settings.messaging },
    );
  } catch {
    return null;
  }
}

/** Delivered: only when this delivery made the SO fully delivered. */
export async function notifyOrderDelivered(
  salesOrderId: string,
  deliveryId: string,
  sentById?: string,
): Promise<OrderTextOutcome | null> {
  try {
    const items = await db.salesOrderItem.findMany({
      where: { salesOrderId, removedAt: null },
      select: { qty: true, deliveredQty: true },
    });
    const progress = soDeliveryProgress(
      items.map((i) => ({ qty: money(i.qty), deliveredQty: money(i.deliveredQty) })),
    );
    if (!progress.fullyDelivered) return null;
    const recipient = await loadRecipient(salesOrderId);
    if (!recipient) return null;
    const { settings } = await getSettingsSnapshot();
    return await sendOrderText(
      {
        kind: "delivered",
        salesOrderNumber: recipient.salesOrderNumber,
        salesOrderId: recipient.salesOrderId,
        sourceId: deliveryId,
        recipient,
        sentById,
      },
      { settings: settings.messaging },
    );
  } catch {
    return null;
  }
}

/** Payment received: once per posted collection, never on void. */
export async function notifyPaymentReceived(
  collectionId: string,
  sentById?: string,
): Promise<OrderTextOutcome | null> {
  try {
    // A collection can allocate to several billings; use the first billing's
    // SO. A collection with no allocations has no order to name — skip.
    const allocation = await db.collectionAllocation.findFirst({
      where: { collectionId },
      orderBy: { id: "asc" },
      include: { billing: { select: { salesOrderId: true } } },
    });
    if (!allocation) return null;
    const recipient = await loadRecipient(allocation.billing.salesOrderId);
    if (!recipient) return null;
    const { settings } = await getSettingsSnapshot();
    return await sendOrderText(
      {
        kind: "payment",
        salesOrderNumber: recipient.salesOrderNumber,
        salesOrderId: recipient.salesOrderId,
        sourceId: collectionId,
        recipient,
        sentById,
      },
      { settings: settings.messaging },
    );
  } catch {
    return null;
  }
}
