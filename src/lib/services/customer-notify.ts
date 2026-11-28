// Customer auto-emails, extended (ERP adoption item 16, Review Board
// run 103). Two automatic emails to the CUSTOMER, fired after the
// business transaction commits:
//
//   1. Payment received — one email PER BILLING a collection settles, in
//      whole or in part: what was applied to that billing (cash, plus
//      withholding tax where the customer withheld), and the billing's
//      remaining balance afterwards (or "paid in full").
//   2. Delivery recorded — one email per delivery on a sales order: the
//      DR number, the lines and quantities delivered this time, and what
//      remains to deliver (or that the order is now complete).
//
// The pattern is the app's existing customer-mail path — the statement
// reminder (src/lib/services/statement-reminder.ts):
//   - Recipient rule: the customer's main ACTIVE contact with an email
//     on file (main contact first, then the earliest created), validated
//     with isValidEmail. No email on file -> nothing is sent, and the
//     skip is audited (one row per billing / per delivery).
//   - Wording: the polite transactional style of the statement reminder
//     and the store order confirmation — facts only, "just reply to this
//     email" closing, NO app links (customers have no staff login).
//   - Figures come from the same reads the screens use: the billing
//     balance is billingBalance() over POSTED collections' allocations
//     plus POSTED return-credit applications — the billing list's math,
//     never a fork of it.
//
// Toggles: Settings -> features, one switch per event, both ON by
// default — the item-5 precedent (features.receivingEmailEnabled) for
// automatic post-commit email. (The statement reminder itself is a
// manual send from the customer screen and has no switch.) A switched-
// off event sends nothing and writes no audit row, exactly like item 5.
//
// Failure posture — copied from items 5 and 8: these run AFTER the
// collection / delivery transaction commits and NEVER throw. A dead
// mailer is logged and audited as failed; the document stands. Voiding
// a collection or a delivery sends NO retraction email.

import { db } from "../db";
import { writeAudit } from "../audit";
import { getMailer, type Mailer } from "../mailer";
import { getSettingsSnapshot } from "../settings";
import { emailIdentity } from "../settings/identity";
import { customerDeliveryRecordedEmail, customerPaymentReceivedEmail } from "../email-templates";
import { billingBalance } from "../billing/status";
import { money } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { formatDate } from "../format";
import { isValidEmail } from "../messaging/phone";
import { sanitizeHeaderValue } from "./statement-reminder";

export type CustomerEmailStatus = "sent" | "failed" | "skipped" | "disabled";

export type CustomerPaymentEmailResult = {
  status: CustomerEmailStatus;
  /** One entry per billing the collection applied money to. */
  perBilling: { billingId: string; billingNumber: string; status: CustomerEmailStatus; to: string | null }[];
};

export type CustomerDeliveryEmailResult = {
  status: CustomerEmailStatus;
  to: string | null;
};

/**
 * The statement reminder's recipient rule, shared verbatim: the
 * customer's main active contact with an email, else the earliest
 * created active contact with one. Null when the customer has no
 * usable email on file.
 */
export async function customerEmailRecipient(customerId: string): Promise<string | null> {
  const contact = await db.contact.findFirst({
    where: { customerId, active: true, archivedAt: null, email: { not: null } },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
  });
  const to = contact?.email?.trim() ?? "";
  return to && isValidEmail(to) ? to : null;
}

async function auditCustomerEmail(input: {
  actorId: string;
  entityType: "Billing" | "Delivery";
  entityId: string;
  event: "customerPaymentReceived" | "customerDeliveryRecorded";
  status: CustomerEmailStatus;
  to: string | null;
  subject?: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  try {
    await writeAudit(db, {
      userId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: "send_email",
      after: {
        customerEmail: input.status,
        event: input.event,
        ...(input.to ? { to: input.to } : {}),
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.extra ?? {}),
      },
      diff: false,
    });
  } catch {
    // Auditing the send must never throw either (item-8 posture).
  }
}

/**
 * Payment received: email the customer once per billing this collection
 * applied money to. Called from recordCollection right after its
 * transaction commits, beside the staff alert. Never throws.
 */
export async function notifyCustomerPaymentReceived(
  collectionId: string,
  actorId: string,
  deps: { mailer?: Mailer } = {},
): Promise<CustomerPaymentEmailResult> {
  try {
    const snap = await getSettingsSnapshot();
    if (!snap.settings.features.customerPaymentEmailEnabled) return { status: "disabled", perBilling: [] };

    const collection = await db.collection.findUnique({
      where: { id: collectionId },
      include: {
        customer: { select: { id: true, name: true } },
        allocations: { select: { billingId: true, cashApplied: true, withholdingApplied: true } },
      },
    });
    // A missing or voided collection announces nothing; a deposit (no
    // allocations) has no billing to write about — the customer hears
    // when the money is applied to a billing, not while it is held.
    if (!collection || collection.status !== "POSTED" || collection.allocations.length === 0) {
      return { status: "skipped", perBilling: [] };
    }

    // One email per billing: group this collection's allocations by
    // billing (repeat applications to one billing sum into one email).
    const byBilling = new Map<string, { cash: bigint; withholding: bigint }>();
    for (const a of collection.allocations) {
      const cur = byBilling.get(a.billingId) ?? { cash: 0n, withholding: 0n };
      cur.cash += toScaled(money(a.cashApplied), 2);
      cur.withholding += toScaled(money(a.withholdingApplied), 2);
      byBilling.set(a.billingId, cur);
    }

    const to = await customerEmailRecipient(collection.customer.id);
    const identity = emailIdentity(snap.settings);
    const mailer = deps.mailer ?? getMailer();
    const perBilling: CustomerPaymentEmailResult["perBilling"] = [];
    let anyFailed = false;

    for (const [billingId, appliedHere] of byBilling) {
      const billing = await db.billing.findUnique({
        where: { id: billingId },
        include: {
          salesOrder: { select: { number: true } },
          allocations: { where: { collection: { status: "POSTED" } } },
          creditApplications: { where: { customerCredit: { customerReturn: { status: "POSTED" } } } },
        },
      });
      if (!billing) continue;
      const billingNumber = billing.number;

      if (!to) {
        await auditCustomerEmail({
          actorId,
          entityType: "Billing",
          entityId: billingId,
          event: "customerPaymentReceived",
          status: "skipped",
          to: null,
          extra: { collectionId, collectionNumber: collection.number, reason: "no_recipient" },
        });
        perBilling.push({ billingId, billingNumber, status: "skipped", to: null });
        continue;
      }

      // The billing list's own balance math (billing/views.ts appliedOf):
      // cash = POSTED collections' cash + POSTED return-credit
      // applications (this collection included — it has committed);
      // withholding = POSTED collections' withholding only.
      const appliedTotal = {
        cashApplied: fromScaled(
          billing.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n) +
            billing.creditApplications.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n),
          2,
        ),
        withholdingApplied: fromScaled(
          billing.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n),
          2,
        ),
      };
      const balance = billingBalance(money(billing.amount), appliedTotal);

      const draft = customerPaymentReceivedEmail(
        {
          customerName: collection.customer.name,
          billingNumber,
          salesOrderNumber: billing.salesOrder.number,
          collectionNumber: collection.number,
          collectionDateLabel: formatDate(collection.date),
          cashApplied: fromScaled(appliedHere.cash, 2),
          withholdingApplied: fromScaled(appliedHere.withholding, 2),
          appliedTotal: fromScaled(appliedHere.cash + appliedHere.withholding, 2),
          balance,
          paidInFull: toScaled(balance, 2) <= 0n,
        },
        identity,
      );
      const subject = sanitizeHeaderValue(draft.subject);

      let status: CustomerEmailStatus = "sent";
      try {
        await mailer.send({ to, subject, text: draft.text, html: draft.html });
      } catch {
        status = "failed";
        anyFailed = true;
        console.error(`[customer-email] payment receipt for billing ${billingNumber} failed to send.`);
      }
      await auditCustomerEmail({
        actorId,
        entityType: "Billing",
        entityId: billingId,
        event: "customerPaymentReceived",
        status,
        to,
        subject,
        extra: { collectionId, collectionNumber: collection.number },
      });
      perBilling.push({ billingId, billingNumber, status, to });
    }

    const status: CustomerEmailStatus =
      perBilling.length === 0
        ? "skipped"
        : perBilling.every((p) => p.status === "skipped")
          ? "skipped"
          : anyFailed && perBilling.every((p) => p.status !== "sent")
            ? "failed"
            : "sent";
    return { status, perBilling };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[customer-email] payment receipt notify failed name=${name}`);
    return { status: "failed", perBilling: [] };
  }
}

/**
 * Delivery recorded: email the customer about one delivery on their
 * sales order. Called from recordDelivery right after its transaction
 * commits, beside the order text. Never throws.
 */
export async function notifyCustomerDeliveryRecorded(
  deliveryId: string,
  actorId: string,
  deps: { mailer?: Mailer } = {},
): Promise<CustomerDeliveryEmailResult> {
  try {
    const snap = await getSettingsSnapshot();
    if (!snap.settings.features.customerDeliveryEmailEnabled) return { status: "disabled", to: null };

    const delivery = await db.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        items: { select: { salesOrderItemId: true, qty: true } },
        salesOrder: {
          select: {
            id: true,
            number: true,
            customer: { select: { id: true, name: true } },
            items: {
              where: { removedAt: null },
              orderBy: { sortOrder: "asc" },
              select: { id: true, description: true, unit: true, qty: true, deliveredQty: true },
            },
          },
        },
      },
    });
    // A voided (or missing) delivery announces nothing.
    if (!delivery || delivery.voidedAt) return { status: "skipped", to: null };
    const so = delivery.salesOrder;

    const to = await customerEmailRecipient(so.customer.id);
    if (!to) {
      await auditCustomerEmail({
        actorId,
        entityType: "Delivery",
        entityId: delivery.id,
        event: "customerDeliveryRecorded",
        status: "skipped",
        to: null,
        extra: { salesOrderNumber: so.number, drNumber: delivery.drNumber, reason: "no_recipient" },
      });
      return { status: "skipped", to: null };
    }

    const lineById = new Map(so.items.map((l) => [l.id, l]));
    const lines = delivery.items
      .filter((i) => Number(i.qty) > 0)
      .map((i) => {
        const line = lineById.get(i.salesOrderItemId);
        return {
          title: line?.description ?? "(line removed from the order)",
          unit: line?.unit ?? "",
          qty: String(i.qty),
        };
      });
    const remaining = so.items
      .filter((l) => Number(l.qty) > Number(l.deliveredQty))
      .map((l) => ({
        title: l.description,
        unit: l.unit,
        qtyRemaining: fromScaled(toScaled(money(l.qty), 2) - toScaled(money(l.deliveredQty), 2), 2),
      }));

    const draft = customerDeliveryRecordedEmail(
      {
        customerName: so.customer.name,
        salesOrderNumber: so.number,
        drNumber: delivery.drNumber,
        deliveryDateLabel: formatDate(delivery.deliveryDate),
        receivedByName: delivery.receivedBy,
        lines,
        remaining,
        fullyDelivered: remaining.length === 0,
      },
      emailIdentity(snap.settings),
    );
    const subject = sanitizeHeaderValue(draft.subject);

    let status: CustomerEmailStatus = "sent";
    try {
      await (deps.mailer ?? getMailer()).send({ to, subject, text: draft.text, html: draft.html });
    } catch {
      status = "failed";
      console.error(`[customer-email] delivery note for ${delivery.drNumber} failed to send.`);
    }
    await auditCustomerEmail({
      actorId,
      entityType: "Delivery",
      entityId: delivery.id,
      event: "customerDeliveryRecorded",
      status,
      to,
      subject,
      extra: { salesOrderNumber: so.number, drNumber: delivery.drNumber },
    });
    return { status, to };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[customer-email] delivery notify failed name=${name}`);
    return { status: "failed", to: null };
  }
}
