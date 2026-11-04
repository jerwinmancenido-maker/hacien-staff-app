// Q17 S-96: per-contact marketing consent (email + SMS, OFF by default),
// append-only consent history, one-click /unsubscribe with a signed token,
// permanent do-not-email suppression, and the Admin CSV export of opted-in
// contacts only. Consent capture only — NO marketing sending is built here.
// Marketing email stays blocked until the Hostinger DPA PDF is on file.

import { createHmac, timingSafeEqual } from "node:crypto";
import { db, isUniqueViolation, type Tx } from "./db";
import { writeAudit } from "./audit";

export const PRIVACY_POLICY_VERSION = "2.1";

/** Rule error for consent flows (suppression guard, missing request, …). */
export class ConsentError extends Error {}

export type ConsentChannel = "email" | "sms";

export type ConsentMeta = {
  source: string;
  changedBy: string;
  ip?: string | null;
  userAgent?: string | null;
};

// ---------------------------------------------------------------------------
// Asia/Manila business days (PHT is UTC+8, no daylight saving).
// ---------------------------------------------------------------------------

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Manila calendar date (year/month/day) for an instant. */
function manilaParts(d: Date): { y: number; m: number; day: number; weekday: number } {
  const m = new Date(d.getTime() + MANILA_OFFSET_MS);
  return { y: m.getUTCFullYear(), m: m.getUTCMonth(), day: m.getUTCDate(), weekday: m.getUTCDay() };
}

/** Midnight Manila time for a Manila calendar date, as a Date. */
function manilaMidnight(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day) - MANILA_OFFSET_MS);
}

/**
 * Add `n` business days (Mon–Fri, Asia/Manila) to `from`, skipping
 * weekends. The result is midnight Manila time on the due date, so staff
 * see a plain calendar due date. Pure — tested without a database.
 */
export function addBusinessDaysManila(from: Date, n: number): Date {
  const p = manilaParts(from);
  let y = p.y;
  let m = p.m;
  let day = p.day;
  let remaining = n;
  while (remaining > 0) {
    const next = new Date(Date.UTC(y, m, day + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth();
    day = next.getUTCDate();
    const weekday = next.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return manilaMidnight(y, m, day);
}

/** Business days (Asia/Manila) a staff member has to complete an email unsubscribe request. */
export const EMAIL_UNSUBSCRIBE_BUSINESS_DAYS = 3;

// ---------------------------------------------------------------------------
// /unsubscribe signed token: HMAC-SHA256 over a payload carrying the
// contact id + email + expiry, keyed by SESSION_SECRET. The raw token is
// never stored; verification recomputes the signature before any state
// change, so a random token unsubscribes nobody.
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function tokenSecret(): string {
  const s = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short. Set it in .env (see .env.example).");
  }
  return s;
}

export function signUnsubscribeToken(contactId: string, email: string, now = new Date()): string {
  const payload = Buffer.from(
    JSON.stringify({ contactId, email: email.toLowerCase(), exp: now.getTime() + TOKEN_TTL_MS }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", tokenSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Returns the contact id + email, or null for a bad, tampered or expired token. Pure. */
export function verifyUnsubscribeToken(token: string, now = new Date()): { contactId: string; email: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = createHmac("sha256", tokenSecret()).update(payload).digest("hex");
  } catch {
    return null;
  }
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      contactId?: unknown;
      email?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.contactId !== "string" || !parsed.contactId) return null;
    if (typeof parsed.email !== "string" || !parsed.email) return null;
    if (typeof parsed.exp !== "number" || parsed.exp <= now.getTime()) return null;
    return { contactId: parsed.contactId, email: parsed.email.toLowerCase() };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Suppression guard. A suppressed email must NOT be opted back in by a
// plain switch flip; only an explicit Admin clear (clearEmailSuppression,
// which stamps clearedAt and writes an audit row) re-opens it.
// ---------------------------------------------------------------------------

/** True when an email opt-in must be refused. Pure. */
export function emailOptInBlocked(suppression: { clearedAt: Date | null } | null): boolean {
  return suppression !== null && suppression.clearedAt === null;
}

// ---------------------------------------------------------------------------
// Consent changes (DB). Each change updates the contact AND writes one
// history row in the same transaction; history rows are never updated.
// ---------------------------------------------------------------------------

async function writeHistory(
  tx: Tx,
  contactId: string,
  channel: ConsentChannel,
  consent: boolean,
  meta: ConsentMeta,
) {
  await tx.marketingConsentHistory.create({
    data: {
      contactId,
      channel,
      consent,
      source: meta.source,
      changedBy: meta.changedBy,
      policyVersion: PRIVACY_POLICY_VERSION,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
}

async function suppressEmail(tx: Tx, email: string, contactId: string, source: string) {
  try {
    await tx.emailSuppression.create({ data: { email: email.toLowerCase(), contactId, source } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Already suppressed: re-activate the guard if it was cleared before.
    await tx.emailSuppression.update({
      where: { email: email.toLowerCase() },
      data: { clearedAt: null, clearedById: null, contactId, source },
    });
  }
}

/**
 * Apply one consent change. Returns { blocked } instead of throwing when
 * a suppressed email is flipped back on — the caller turns that into a
 * form error. A no-op (same value) writes no history row.
 */
export async function applyConsentChange(
  contactId: string,
  channel: ConsentChannel,
  consent: boolean,
  meta: ConsentMeta,
): Promise<{ blocked?: string }> {
  return db.$transaction(async (tx) => {
    const contact = await tx.contact.findUniqueOrThrow({ where: { id: contactId } });
    const field = channel === "email" ? "marketingEmailConsent" : "marketingSmsConsent";
    if (contact[field] === consent) return {};
    if (channel === "email" && consent && contact.email) {
      const suppression = await tx.emailSuppression.findUnique({ where: { email: contact.email.toLowerCase() } });
      if (emailOptInBlocked(suppression)) {
        return {
          blocked:
            "This email is on the do-not-email list. Clear the suppression explicitly (Admin) before opting it back in.",
        };
      }
    }
    await tx.contact.update({
      where: { id: contactId },
      data: { [field]: consent, ...(channel === "email" && !consent ? { emailUnsubscribeDueAt: null } : {}) },
    });
    await writeHistory(tx, contactId, channel, consent, meta);
    return {};
  });
}

/** Record an email unsubscribe request: due date 3 Manila business days out. */
export async function recordEmailUnsubscribeRequest(contactId: string, actorId: string, now = new Date()): Promise<Date> {
  return db.$transaction(async (tx) => {
    const contact = await tx.contact.findUniqueOrThrow({ where: { id: contactId } });
    if (contact.emailUnsubscribeDueAt) return contact.emailUnsubscribeDueAt;
    const due = addBusinessDaysManila(now, EMAIL_UNSUBSCRIBE_BUSINESS_DAYS);
    const after = await tx.contact.update({ where: { id: contactId }, data: { emailUnsubscribeDueAt: due } });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "Contact",
      entityId: contactId,
      action: "update",
      before: contact,
      after,
    });
    return due;
  });
}

/** Complete a pending email unsubscribe request: suppression + consent OFF + history. */
export async function completeEmailUnsubscribeRequest(contactId: string, meta: ConsentMeta): Promise<void> {
  await db.$transaction(async (tx) => {
    const contact = await tx.contact.findUniqueOrThrow({ where: { id: contactId } });
    if (!contact.emailUnsubscribeDueAt) {
      throw new ConsentError("No pending email unsubscribe request for this contact.");
    }
    if (contact.email) await suppressEmail(tx, contact.email, contactId, "staff-completed email request");
    await tx.contact.update({
      where: { id: contactId },
      data: { marketingEmailConsent: false, emailUnsubscribeDueAt: null },
    });
    await writeHistory(tx, contactId, "email", false, { ...meta, source: "staff-completed email request" });
  });
}

/**
 * One-click /unsubscribe. Verifies the token BEFORE any state change.
 * Idempotent: an already-unsubscribed contact succeeds again with
 * `already: true`, so a duplicate click (or a forwarded link) is harmless.
 */
export async function unsubscribeViaLink(
  token: string,
  meta: Omit<ConsentMeta, "source" | "changedBy">,
  now = new Date(),
): Promise<{ ok: boolean; already?: boolean }> {
  const verified = verifyUnsubscribeToken(token, now);
  if (!verified) return { ok: false };
  return db.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id: verified.contactId } });
    if (!contact || !contact.email || contact.email.toLowerCase() !== verified.email) return { ok: false };
    const suppression = await tx.emailSuppression.findUnique({ where: { email: verified.email } });
    if (contact.marketingEmailConsent === false && emailOptInBlocked(suppression)) {
      return { ok: true, already: true };
    }
    await suppressEmail(tx, verified.email, contact.id, "unsubscribe link");
    await tx.contact.update({
      where: { id: contact.id },
      data: { marketingEmailConsent: false, emailUnsubscribeDueAt: null },
    });
    await writeHistory(tx, contact.id, "email", false, {
      source: "unsubscribe link",
      changedBy: "link",
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { ok: true };
  });
}

/** Explicit Admin clear of a suppression. The row stays (never deleted); only clearedAt is stamped. */
export async function clearEmailSuppression(email: string, actorId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.emailSuppression.findUnique({ where: { email: email.toLowerCase() } });
    if (!row || row.clearedAt) return;
    const after = await tx.emailSuppression.update({
      where: { email: email.toLowerCase() },
      data: { clearedAt: new Date(), clearedById: actorId },
    });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "EmailSuppression",
      entityId: row.id,
      action: "update",
      before: row,
      after,
    });
  });
}

// ---------------------------------------------------------------------------
// Admin CSV export: opted-in contacts only.
// ---------------------------------------------------------------------------

export type OptedInContactRow = {
  name: string;
  companyName: string;
  companyType: "customer" | "supplier";
  email: string | null;
  phone: string | null;
  emailConsent: boolean;
  smsConsent: boolean;
  emailSuppressed: boolean;
};

export const OPTED_IN_CSV_COLUMNS = [
  "contact_name",
  "company_name",
  "company_type",
  "email",
  "phone",
  "email_consent",
  "sms_consent",
  "email_suppressed",
] as const;

/**
 * Filter + map to CSV rows. A contact is included only when at least one
 * channel qualifies: email consent ON with an email on file and no active
 * suppression, or SMS consent ON. Pure — tested without a database.
 */
export function optedInCsvRows(contacts: OptedInContactRow[]): string[][] {
  const rows: string[][] = [];
  for (const c of contacts) {
    const emailOk = c.emailConsent && !!c.email && !c.emailSuppressed;
    const smsOk = c.smsConsent;
    if (!emailOk && !smsOk) continue;
    rows.push([
      c.name,
      c.companyName,
      c.companyType,
      c.email ?? "",
      c.phone ?? "",
      emailOk ? "yes" : "no",
      smsOk ? "yes" : "no",
      c.emailSuppressed ? "yes" : "no",
    ]);
  }
  return rows;
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header + rows as CSV text. Pure. */
export function optedInContactsToCsv(contacts: OptedInContactRow[]): string {
  const lines = [[...OPTED_IN_CSV_COLUMNS].join(","), ...optedInCsvRows(contacts).map((r) => r.map(csvEscape).join(","))];
  return lines.join("\r\n") + "\r\n";
}

/** DB query behind the export route: active contacts, joined to suppressions. */
export async function getOptedInContactsCsv(): Promise<string> {
  const contacts = await db.contact.findMany({
    where: { active: true, OR: [{ marketingEmailConsent: true }, { marketingSmsConsent: true }] },
    include: { customer: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const emails = [...new Set(contacts.map((c) => c.email?.toLowerCase()).filter((e): e is string => !!e))];
  const suppressions = emails.length
    ? await db.emailSuppression.findMany({ where: { email: { in: emails }, clearedAt: null } })
    : [];
  const suppressed = new Set(suppressions.map((s) => s.email));
  return optedInContactsToCsv(
    contacts.map((c) => ({
      name: c.name,
      companyName: c.customer?.name ?? c.supplier?.name ?? "",
      companyType: c.customer ? "customer" : "supplier",
      email: c.email,
      phone: c.phone,
      emailConsent: c.marketingEmailConsent,
      smsConsent: c.marketingSmsConsent,
      emailSuppressed: !!c.email && suppressed.has(c.email.toLowerCase()),
    })),
  );
}
