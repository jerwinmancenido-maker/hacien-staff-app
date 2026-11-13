// Phase 3 #9: send a customer's statement of account as a payment reminder
// email, from the customer screen. One solid rule set:
//  - Configuration first: with no SMTP host the send is refused as
//    "not configured" BEFORE anything is written — no sent record, no
//    audit row (scenario E1; that state is also the staging proof, since
//    staging has no SMTP).
//  - Figures come from getStatement() — the same source as the printed
//    statement, which reads the current settings snapshot — so the email
//    can never disagree with the print for the same period (E2).
//  - Every successful send writes a StatementReminderSend row AND an
//    audit row in one transaction.
//  - Duplicate guard: the same customer + recipient + period inside the
//    guard window is refused server-side (E3, double-click / retry safe).
//  - Subject and names are header-sanitised (CR/LF stripped) so a crafted
//    customer name cannot inject mail headers.
// D2 wording — decided by Muse under the FINAL RULES (2026-11-13,
// recorded on the Finish-All dashboard): polite summary wording, balance
// + overdue only, "already paid, please disregard" line, reply-to-us
// closing. Transactional only — never marketing.

import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { writeAudit } from "@/lib/audit";
import { getStatement } from "@/lib/billing/views";
import { getMailer, type Mailer } from "@/lib/mailer";
import { formatPeso, formatDate } from "@/lib/format";
import { isValidEmail } from "@/lib/messaging/phone";

/** Short window in which a repeat send to the same recipient is a duplicate. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** True only when an SMTP host is configured (env name only, never a value). */
export function emailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SMTP_HOST?.trim());
}

/** Strip CR/LF (and trim) so a value can sit safely in a mail header. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export type StatementReminderDraft = { subject: string; text: string };

/** Pure builder for the reminder email (D2 wording, decided 2026-11-14). */
export function buildStatementReminder(input: {
  customerName: string;
  companyName: string;
  closingBalance: string;
  overdue: string;
  from: string | null;
  to: string | null;
  asOf: Date;
}): StatementReminderDraft {
  const customer = sanitizeHeaderValue(input.customerName);
  const company = sanitizeHeaderValue(input.companyName) || "HACIEN";
  const subject = sanitizeHeaderValue(`Statement of account — ${customer}`);
  const period = input.from || input.to ? `${input.from ?? "…"} to ${input.to ?? "…"}` : "All transactions to date";
  const lines = [
    "Good day,",
    "",
    `Here is a summary of your statement of account with ${company}, as of ${formatDate(input.asOf)}.`,
    "",
    `Balance due: ${formatPeso(input.closingBalance)}`,
  ];
  if (Number(input.overdue) > 0) lines.push(`Overdue: ${formatPeso(input.overdue)}`);
  lines.push(
    `Period covered: ${period}`,
    "",
    "If you have already paid any amount above, please disregard this note. Otherwise, we would appreciate payment at your earliest convenience.",
    "Questions about this statement? Just reply to this email and we will be glad to help.",
    "",
    company,
    "",
    "Statement of account — not an official invoice. System-generated, no signature required.",
  );
  return { subject, text: lines.join("\n") };
}

/** Pure duplicate check: a prior send inside the window blocks a repeat. */
export function isDuplicateSend(
  prior: { sentAt: Date } | null,
  now: Date,
  windowMs: number = DUPLICATE_WINDOW_MS,
): boolean {
  if (!prior) return false;
  return now.getTime() - prior.sentAt.getTime() < windowMs;
}

export type SendStatementReminderResult =
  | { ok: true; sendId: string; to: string }
  | { ok: false; reason: "not_configured" | "no_recipient" | "nothing_due" | "duplicate"; message: string };

type Deps = {
  configured?: boolean;
  mailer?: Mailer;
  now?: Date;
};

/**
 * Send the statement reminder for one customer. Deps are injectable for
 * tests; production uses the real config check, mailer and clock.
 */
export async function sendStatementReminder(
  actorId: string,
  customerId: string,
  period: { from: Date | null; to: Date | null },
  deps: Deps = {},
): Promise<SendStatementReminderResult> {
  const now = deps.now ?? new Date();
  // E1: configuration check first — nothing is read or written before it.
  if (!(deps.configured ?? emailConfigured())) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Email is not configured on this server.",
    };
  }
  const stmt = await getStatement(customerId, period.from, period.to);
  if (!stmt) throw new DocRuleError("Customer not found.");
  if (Number(stmt.closingBalance) <= 0) {
    return { ok: false, reason: "nothing_due", message: "Nothing to remind — this customer has no balance due." };
  }
  const contact = await db.contact.findFirst({
    where: { customerId, active: true, archivedAt: null, email: { not: null } },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
  });
  const to = contact?.email?.trim() ?? "";
  if (!to || !isValidEmail(to)) {
    return { ok: false, reason: "no_recipient", message: "No email address on file for this customer." };
  }
  const prior = await db.statementReminderSend.findFirst({
    where: {
      customerId,
      recipient: to,
      periodFrom: period.from,
      periodTo: period.to,
      sentAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
    },
    orderBy: { sentAt: "desc" },
  });
  if (isDuplicateSend(prior, now)) {
    return {
      ok: false,
      reason: "duplicate",
      message: "A reminder for this statement was already sent a few minutes ago.",
    };
  }
  const overdue = String(Number(stmt.aging.total) - Number(stmt.aging.current));
  const draft = buildStatementReminder({
    customerName: stmt.customer.name,
    companyName: stmt.company.name,
    closingBalance: stmt.closingBalance,
    overdue,
    from: stmt.from,
    to: stmt.to,
    asOf: now,
  });
  await (deps.mailer ?? getMailer()).send({ to, subject: draft.subject, text: draft.text });
  const send = await db.$transaction(async (tx) => {
    const row = await tx.statementReminderSend.create({
      data: {
        customerId,
        recipient: to,
        periodFrom: period.from,
        periodTo: period.to,
        closingBalance: stmt.closingBalance,
        sentById: actorId,
        sentAt: now,
      },
    });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "StatementReminder",
      entityId: row.id,
      action: "send_email",
      after: { customerId, to, periodFrom: stmt.from, periodTo: stmt.to, closingBalance: stmt.closingBalance },
      diff: false,
    });
    return row;
  });
  return { ok: true, sendId: send.id, to };
}

/** Read model for the customer screen: can we offer a send, and to whom? */
export async function statementReminderPreview(customerId: string): Promise<{
  configured: boolean;
  recipient: string | null;
  lastSentAt: string | null;
}> {
  const [contact, last] = await Promise.all([
    db.contact.findFirst({
      where: { customerId, active: true, archivedAt: null, email: { not: null } },
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    }),
    db.statementReminderSend.findFirst({ where: { customerId }, orderBy: { sentAt: "desc" } }),
  ]);
  const email = contact?.email?.trim() ?? null;
  return {
    configured: emailConfigured(),
    recipient: email && isValidEmail(email) ? email : null,
    lastSentAt: last ? last.sentAt.toISOString() : null,
  };
}
