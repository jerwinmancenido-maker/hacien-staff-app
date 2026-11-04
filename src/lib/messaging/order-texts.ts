// Order-status texts (Q16, S-95), built on the Q15 messaging base.
// Sender is always HACIEN. Templates are status only — never promotional,
// never amounts, balances, 2307, URLs or links. Body carries first name and
// SO number only, per the owner's approved wording.
//
// Gating, in order — a text is sent only if ALL pass:
//   1. Settings messaging.orderTextsEnabled is on (Default chosen: OFF until
//      UniSMS keys, the UniSMS DPA + DB location, and the HACIEN sender ID
//      are confirmed — see the PR description).
//   2. The template for this kind is on in the same settings.
//   3. The customer's "Order text updates" switch is on (on by default).
//   4. A valid Philippine mobile is on file.
//   5. This exact event has not been sent before (OrderTextSent).
// A failed / not-sent attempt creates no OrderTextSent row, so an Admin
// retry from the send log is not blocked. A send here NEVER throws: a
// failure is returned, so a caller must never let it roll back the order,
// delivery or payment that triggered it. Callers must call this AFTER the
// main record's transaction commits.

import { db } from "@/lib/db";
import { normalizePhMobile } from "./phone";
import { sendMessage, type SendResult } from "./send";
import type { Settings } from "@/lib/settings/schema";

export type OrderTextKind = "confirmed" | "delivered" | "payment";

export type OrderTextSettings = Settings["messaging"];

export type OrderTextRecipient = {
  customerName: string;
  /** Customer's order-text switch. */
  orderTextUpdates: boolean;
  /** SO contact name first, else main contact name, else customer name. */
  contactName: string | null;
  /** SO contact phone first, else main contact phone. */
  contactPhone: string | null;
};

export type OrderTextInput = {
  kind: OrderTextKind;
  salesOrderNumber: string;
  salesOrderId: string;
  /** confirmed: SO id; delivered: delivery id; payment: collection id. */
  sourceId: string;
  recipient: OrderTextRecipient;
  sentById?: string;
};

export type OrderTextOutcome =
  | { status: "sent"; logId: string }
  | { status: "skipped"; reason: string }
  | { status: "not_sent"; reason: string; logId: string }
  | { status: "failed"; reason: string; logId?: string };

/** First token of a name, or "there" when nothing usable is on file. */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : "there";
}

/** Owner-approved templates (Nov 4, 2026). First name + SO number only. */
export function orderTextBody(kind: OrderTextKind, first: string, soNumber: string): string {
  if (kind === "confirmed") return `Hi ${first}, your order ${soNumber} is confirmed. Thank you!`;
  if (kind === "delivered") return `Hi ${first}, your order ${soNumber} has been delivered. Thank you!`;
  return `Hi ${first}, we received payment for your order ${soNumber}. Thank you!`;
}

export function orderTextEventKey(kind: OrderTextKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

function templateEnabled(kind: OrderTextKind, settings: OrderTextSettings): boolean {
  if (kind === "confirmed") return settings.orderConfirmed;
  if (kind === "delivered") return settings.orderDelivered;
  return settings.orderPayment;
}

export type OrderTextDedupStore = {
  exists(eventKey: string): Promise<boolean>;
  mark(input: { eventKey: string; kind: OrderTextKind; salesOrderId: string; sourceId: string }): Promise<void>;
};

export const prismaOrderTextDedup: OrderTextDedupStore = {
  async exists(eventKey) {
    const row = await db.orderTextSent.findUnique({ where: { eventKey }, select: { id: true } });
    return row != null;
  },
  async mark(input) {
    try {
      await db.orderTextSent.create({ data: input });
    } catch {
      // Unique-key race: another process sent the same event first. The
      // send already happened, so a duplicate row must not fail the caller.
    }
  },
};

export type OrderTextDeps = {
  settings: OrderTextSettings;
  /** Injected in tests; production uses sendMessage from the Q15 base. */
  send?: (input: { to: string; body: string; sentById?: string }) => Promise<SendResult>;
  dedup?: OrderTextDedupStore;
};

/** Send one order-status text, or skip without throwing. Never throws. */
export async function sendOrderText(input: OrderTextInput, deps: OrderTextDeps): Promise<OrderTextOutcome> {
  try {
    if (!deps.settings.orderTextsEnabled) return { status: "skipped", reason: "Order texts are off." };
    if (!templateEnabled(input.kind, deps.settings)) {
      return { status: "skipped", reason: "This order text template is off." };
    }
    if (!input.recipient.orderTextUpdates) {
      return { status: "skipped", reason: "Customer has order text updates off." };
    }
    const mobile = normalizePhMobile(input.recipient.contactPhone ?? "");
    if (!mobile) return { status: "skipped", reason: "No valid Philippine mobile on file." };
    const eventKey = orderTextEventKey(input.kind, input.sourceId);
    const dedup = deps.dedup ?? prismaOrderTextDedup;
    if (await dedup.exists(eventKey)) {
      return { status: "skipped", reason: "This order text was already sent." };
    }
    const first = firstName(input.recipient.contactName ?? input.recipient.customerName);
    const body = orderTextBody(input.kind, first, input.salesOrderNumber);
    const send = deps.send ?? ((args) => sendMessage({ channel: "sms", ...args }));
    const result = await send({ to: mobile, body, sentById: input.sentById });
    if (!result.ok) {
      // Not marked as sent: an Admin retry from the send log stays possible.
      return { status: result.status, reason: result.error, logId: result.logId };
    }
    await dedup.mark({ eventKey, kind: input.kind, salesOrderId: input.salesOrderId, sourceId: input.sourceId });
    return { status: "sent", logId: result.logId };
  } catch (e) {
    // A text failure must never roll back the order / delivery / payment.
    return { status: "failed", reason: e instanceof Error ? e.message : "Order text failed." };
  }
}
