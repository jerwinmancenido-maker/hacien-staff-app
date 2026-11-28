// Email alert rules engine (ERP adoption item 8, Review Board run 103).
//
// The ERP fires chat alerts when things happen (a document is created, an
// approval lands, a payment moves). This app has no chat integration — and
// adding one needs a bot key, which is a secret — so the channel is EMAIL
// via the existing mailer. The stored rule shape carries a `channel` field
// (only "email" today) so a chat channel can slot in later without
// reshaping the data.
//
// Rules live in Settings (the `alerts` section): one rule per event with
// an on/off switch, the roles that hear about it, and extra addresses.
// Settings are versioned + audited, which is why no new table was needed.
//
// Failure posture — copied from the item-5 receiving email: an alert fires
// AFTER the business transaction commits and NEVER throws. A dead mailer
// is logged and audited; the document stands. Alerts are one-way notes:
// they carry no action links and approve nothing — approvals stay in the
// app (the approval inbox, item 1).

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { writeAudit, type AuditEntityType } from "../audit";
import { appUrl, getMailer, type Mailer } from "../mailer";
import { getSettingsSnapshot } from "../settings";
import { emailIdentity, type EmailIdentity } from "../settings/identity";
import { staffAlertEmail } from "../email-templates";
import { formatDate, formatPeso } from "../format";
import type { AlertEventKey, AlertRole, AlertRule } from "../settings/schema";
import { sanitizeHeaderValue } from "./statement-reminder";

export type AlertStatus = "sent" | "partial" | "failed" | "skipped" | "disabled";
export type AlertFireResult = { status: AlertStatus; recipients: string[] };

const ROLE_WHERE: Record<AlertRole, Prisma.UserWhereInput> = {
  admin: { isAdmin: true },
  approver: { isApprover: true },
  staff: { isStaff: true },
};

/** Case-insensitive de-dupe, first spelling wins, order preserved. */
export function mergeRecipients(userEmails: readonly string[], extraEmails: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const e of [...userEmails, ...extraEmails]) {
    const key = e.toLowerCase();
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

async function resolveRecipients(rule: AlertRule, extraRecipientUserIds: readonly string[]): Promise<string[]> {
  const ors: Prisma.UserWhereInput[] = rule.roles.map((r) => ROLE_WHERE[r]);
  if (extraRecipientUserIds.length > 0) ors.push({ id: { in: [...extraRecipientUserIds] } });
  let userEmails: string[] = [];
  if (ors.length > 0) {
    const users = await db.user.findMany({
      where: { active: true, OR: ors },
      select: { email: true },
      orderBy: { email: "asc" },
    });
    userEmails = users.map((u) => u.email);
  }
  return mergeRecipients(userEmails, rule.emails);
}

export type AlertInput = {
  entityType: AuditEntityType;
  entityId: string;
  /** Whose action fired the event — recorded as the audit row's user. */
  actorId: string;
  /** Extra people who always hear about this specific document (e.g. the PO's creator). */
  extraRecipientUserIds?: readonly string[];
  /**
   * Key in the audit `after` object that carries the send status.
   * goodsReceived keeps its item-5 key ("receivingEmail"); the rest use "alert".
   */
  auditStatusKey?: string;
  buildEmail: (identity: EmailIdentity) => { subject: string; text: string; html: string };
};

/**
 * Fire one alert. Reads the event's rule from the current Settings
 * snapshot; a disabled rule (or one with nobody to send to) sends nothing.
 * Never throws.
 */
export async function fireAlert(
  event: AlertEventKey,
  input: AlertInput,
  deps: { mailer?: Mailer } = {},
): Promise<AlertFireResult> {
  try {
    const snap = await getSettingsSnapshot();
    const rule: AlertRule | undefined = snap.settings.alerts[event];
    if (!rule || !rule.enabled) return { status: "disabled", recipients: [] };

    const recipients = await resolveRecipients(rule, input.extraRecipientUserIds ?? []);
    if (recipients.length === 0) {
      console.error(`[alerts] ${event} alert has no recipients.`);
      return { status: "skipped", recipients: [] };
    }

    const draft = input.buildEmail(emailIdentity(snap.settings));
    const subject = sanitizeHeaderValue(draft.subject);

    const mailer = deps.mailer ?? getMailer();
    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      try {
        await mailer.send({ to, subject, text: draft.text, html: draft.html });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    const status: AlertStatus = failed === 0 ? "sent" : sent === 0 ? "failed" : "partial";

    try {
      await writeAudit(db, {
        userId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: "send_email",
        after: { recipients, [input.auditStatusKey ?? "alert"]: status, event, subject },
        diff: false,
      });
    } catch {
      // Auditing the send must never throw either.
    }
    if (failed > 0) {
      console.error(`[alerts] ${event} alert: ${sent} sent, ${failed} failed.`);
    }
    return { status, recipients };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[alerts] ${event} alert failed name=${name}`);
    return { status: "failed", recipients: [] };
  }
}

async function actorName(actorId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: actorId }, select: { name: true } });
  return u?.name ?? "A teammate";
}

// ---------------------------------------------------------------------------
// Per-event wrappers. Each fetches the just-committed document, builds the
// alert and fires it. Called from the services right after their
// transaction commits, beside the existing post-commit side effects.
// ---------------------------------------------------------------------------

export async function notifySupplierPaymentRecorded(
  paymentId: string,
  actorId: string,
  deps: { mailer?: Mailer } = {},
): Promise<AlertFireResult> {
  try {
    const p = await db.supplierPayment.findUnique({
      where: { id: paymentId },
      include: { supplier: { select: { name: true } } },
    });
    if (!p) return { status: "skipped", recipients: [] };
    const by = await actorName(actorId);
    return fireAlert(
      "supplierPayment",
      {
        entityType: "SupplierPayment",
        entityId: p.id,
        actorId,
        buildEmail: (identity) =>
          staffAlertEmail(
            {
              subject: `Supplier payment recorded — ${p.number}`,
              heading: "Supplier payment recorded",
              intro: `A payment to ${p.supplier.name} was recorded by ${by}.`,
              lines: [
                `Payment: ${p.number}`,
                `Supplier: ${p.supplier.name}`,
                `Amount paid: ${formatPeso(p.amountPaid)}`,
                `Method: ${p.method}`,
                `Date: ${formatDate(p.date)}`,
              ],
              url: appUrl(`/payables/payments/${p.id}`),
              urlLabel: "View the payment",
            },
            identity,
          ),
      },
      deps,
    );
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[alerts] supplierPayment notify failed name=${name}`);
    return { status: "failed", recipients: [] };
  }
}

export async function notifyCollectionRecorded(
  collectionId: string,
  actorId: string,
  deps: { mailer?: Mailer } = {},
): Promise<AlertFireResult> {
  try {
    const c = await db.collection.findUnique({
      where: { id: collectionId },
      include: { customer: { select: { name: true } } },
    });
    if (!c) return { status: "skipped", recipients: [] };
    const by = await actorName(actorId);
    return fireAlert(
      "collection",
      {
        entityType: "Collection",
        entityId: c.id,
        actorId,
        buildEmail: (identity) =>
          staffAlertEmail(
            {
              subject: `Collection recorded — ${c.number}`,
              heading: "Collection recorded",
              intro: `A collection from ${c.customer.name} was recorded by ${by}.`,
              lines: [
                `Collection: ${c.number}`,
                `Customer: ${c.customer.name}`,
                `Amount received: ${formatPeso(c.amountReceived)}`,
                `Date: ${formatDate(c.date)}`,
              ],
              url: appUrl(`/billing/collections/${c.id}`),
              urlLabel: "View the collection",
            },
            identity,
          ),
      },
      deps,
    );
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[alerts] collection notify failed name=${name}`);
    return { status: "failed", recipients: [] };
  }
}

export async function notifyQuoteApproved(
  quoteId: string,
  actorId: string,
  deps: { mailer?: Mailer } = {},
): Promise<AlertFireResult> {
  try {
    const q = await db.quote.findUnique({
      where: { id: quoteId },
      include: { customer: { select: { name: true } } },
    });
    if (!q) return { status: "skipped", recipients: [] };
    const by = await actorName(actorId);
    return fireAlert(
      "quoteApproved",
      {
        entityType: "Quote",
        entityId: q.id,
        actorId,
        buildEmail: (identity) =>
          staffAlertEmail(
            {
              subject: `Quote approved — ${q.number}`,
              heading: "Quote approved",
              intro: `Quote ${q.number} for ${q.customer.name} was approved by ${by}.`,
              lines: [
                `Quote: ${q.number}`,
                `Customer: ${q.customer.name}`,
                `Contract price: ${formatPeso(q.contractPrice)}`,
              ],
              url: appUrl(`/quotes/${q.id}`),
              urlLabel: "View the quote",
            },
            identity,
          ),
      },
      deps,
    );
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[alerts] quoteApproved notify failed name=${name}`);
    return { status: "failed", recipients: [] };
  }
}

export async function notifySalesOrderConfirmed(
  salesOrderId: string,
  actorId: string,
  deps: { mailer?: Mailer } = {},
): Promise<AlertFireResult> {
  try {
    const so = await db.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: { customer: { select: { name: true } }, quote: { select: { number: true } } },
    });
    if (!so) return { status: "skipped", recipients: [] };
    const by = await actorName(actorId);
    return fireAlert(
      "salesOrderConfirmed",
      {
        entityType: "SalesOrder",
        entityId: so.id,
        actorId,
        buildEmail: (identity) =>
          staffAlertEmail(
            {
              subject: `Sales order confirmed — ${so.number}`,
              heading: "Sales order confirmed",
              intro: `Sales order ${so.number} for ${so.customer.name} was confirmed by ${by}.`,
              lines: [
                `Sales order: ${so.number}`,
                `Customer: ${so.customer.name}`,
                `Contract price: ${formatPeso(so.contractPrice)}`,
                ...(so.quote ? [`From quote: ${so.quote.number}`] : []),
                ...(so.buyerPoNo ? [`Buyer PO no.: ${so.buyerPoNo}`] : []),
              ],
              url: appUrl(`/sales-orders/${so.id}`),
              urlLabel: "View the sales order",
            },
            identity,
          ),
      },
      deps,
    );
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[alerts] salesOrderConfirmed notify failed name=${name}`);
    return { status: "failed", recipients: [] };
  }
}
