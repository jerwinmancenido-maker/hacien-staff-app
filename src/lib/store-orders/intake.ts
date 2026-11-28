// Store-order intake (Online Store plan rev 4, Slice 1): the service behind
// POST /api/v1/store-orders. A paid web order lands as a StoreOrder record —
// never as a Sales Order (external events never mint ledger numbers; the WO
// number allocated here is an inbox reference). Conversion is a staff click
// in Slice 2; this module only receives, validates, dedupes and files.
//
// Rules of record:
// - Money rule at the door: Σ(qty × unitPrice) + deliveryFee must equal
//   amountPaid to the centavo, else 400 amount_mismatch and nothing lands.
//   The check runs in scaled-integer centavos — no float, no rounding drift.
// - Permanent dedupe on the gateway idempotency key (unique column): the
//   /api/v1 transport idempotency only replays for 24 h, so a re-post after
//   the window returns the existing order with duplicate: true.
// - SKU match: exactly one ACTIVE item with the SKU maps the line; zero or
//   several matches flag it (never drop a line).
// - Buyer match is a PROPOSAL only (Contact.email → Contact.phone → exact
//   customer name). Staff confirm at conversion; money never auto-attaches.
// - The confirmation email is sent AFTER the intake transaction commits and
//   can never fail the intake (statement-reminder pattern).

import type { StoreOrderStatus } from "@prisma/client";
import { writeAudit } from "../audit";
import type { ApiActor } from "../api/keys";
import { ApiError } from "../api/errors";
import { db, isUniqueViolation, type Tx } from "../db";
import { findNearNameMatches } from "../duplicates";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { TIME_ZONE } from "../format";
import { getMailer, type Mailer } from "../mailer";
import { isValidEmail } from "../messaging/phone";
import { getSettingsSnapshot } from "../settings";
import { emailIdentity } from "../settings/identity";
import { storeOrderConfirmationEmail } from "../email-templates";
import { DUPLICATE_WINDOW_MS, emailConfigured, sanitizeHeaderValue } from "../services/statement-reminder";

export type StoreOrderIntakeResult = {
  order: { id: string; number: string; status: StoreOrderStatus };
  duplicate: boolean;
};

type IntakeDeps = {
  mailer?: Mailer;
  now?: Date;
  configured?: boolean;
};

type ParsedLine = {
  sku: string | null;
  title: string;
  qty: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  termEndDate: Date | null;
};

type ParsedIntake = {
  gatewayName: string;
  gatewayPaymentRef: string;
  gatewayPaymentKey: string;
  paidAt: Date;
  amountPaid: string;
  gatewayFee: string;
  deliveryFee: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  addressLabel: string | null;
  addressStreet: string;
  addressBarangay: string;
  addressCityMunicipality: string;
  addressProvince: string;
  addressZip: string;
  notes: string | null;
  lines: ParsedLine[];
};

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

/** Decimal string (≤2 dp, non-negative) → hundredths as BigInt. Null if malformed. */
function toHundredths(value: string): bigint | null {
  if (!DECIMAL_RE.test(value)) return null;
  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

function fromHundredths(h: bigint): string {
  return `${h / 100n}.${String(h % 100n).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function reqString(rec: Record<string, unknown>, key: string, max: number, fields: Record<string, string>): string {
  const v = rec[key];
  if (typeof v !== "string" || !v.trim()) {
    fields[key] = "Required.";
    return "";
  }
  const t = v.trim();
  if (t.length > max) fields[key] = `Keep it under ${max} characters.`;
  return t;
}

function optString(rec: Record<string, unknown>, key: string, max: number, fields: Record<string, string>): string {
  const v = rec[key];
  if (v == null) return "";
  if (typeof v !== "string") {
    fields[key] = "Must be text.";
    return "";
  }
  const t = v.trim();
  if (t.length > max) fields[key] = `Keep it under ${max} characters.`;
  return t;
}

/** Money/qty field: a decimal string (a JSON number is accepted via its exact string form). */
function moneyString(rec: Record<string, unknown>, key: string, fields: Record<string, string>): string {
  const v = rec[key];
  const s = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  if (!s || toHundredths(s) === null) {
    fields[key] = "Send a decimal string like \"1500.00\" (2 decimal places at most).";
    return "0";
  }
  return fromHundredths(toHundredths(s) as bigint);
}

function mergeFields(target: Record<string, string>, prefix: string, local: Record<string, string>): void {
  for (const [k, v] of Object.entries(local)) target[`${prefix}.${k}`] = v;
}

function parseIntake(body: unknown): ParsedIntake {
  const root = asRecord(body);
  if (!root) throw new ApiError(400, "validation", "Send a JSON object.");
  const fields: Record<string, string> = {};

  const gateway = asRecord(root.gateway);
  if (!gateway) fields.gateway = "Required.";
  const gw: Record<string, string> = {};
  const gatewayName = reqString(gateway ?? {}, "name", 100, gw);
  const gatewayPaymentRef = reqString(gateway ?? {}, "paymentRef", 191, gw);
  const gatewayPaymentKey = reqString(gateway ?? {}, "idempotencyKey", 191, gw);
  mergeFields(fields, "gateway", gw);

  const paidAtRaw = root.paidAt;
  const paidAt = typeof paidAtRaw === "string" ? new Date(paidAtRaw) : new Date(NaN);
  if (Number.isNaN(paidAt.getTime())) fields.paidAt = "Send an ISO-8601 timestamp.";

  if (root.currency !== "PHP") fields.currency = "Only PHP orders are accepted.";

  const amountPaid = moneyString(root, "amountPaid", fields);
  const gatewayFee = moneyString(root, "gatewayFee", fields);
  const deliveryFee = moneyString(root, "deliveryFee", fields);
  if (toHundredths(amountPaid) === 0n && !fields.amountPaid) fields.amountPaid = "Must be more than 0.";

  const buyer = asRecord(root.buyer);
  if (!buyer) fields.buyer = "Required.";
  const bf: Record<string, string> = {};
  const buyerName = reqString(buyer ?? {}, "name", 191, bf);
  const buyerEmail = reqString(buyer ?? {}, "email", 191, bf);
  if (buyerEmail && !isValidEmail(buyerEmail)) bf.email = "That email address does not look valid.";
  const buyerPhone = reqString(buyer ?? {}, "phone", 64, bf);
  mergeFields(fields, "buyer", bf);

  const addr = asRecord(root.deliveryAddress);
  if (!addr) fields.deliveryAddress = "Required.";
  const af: Record<string, string> = {};
  const addressLabelRaw = optString(addr ?? {}, "label", 100, af);
  const addressStreet = reqString(addr ?? {}, "street", 2000, af);
  const addressBarangay = optString(addr ?? {}, "barangay", 120, af);
  const addressCityMunicipality = optString(addr ?? {}, "cityMunicipality", 120, af);
  const addressProvince = optString(addr ?? {}, "province", 120, af);
  const addressZip = optString(addr ?? {}, "zip", 4, af);
  if (addressZip && !/^\d{4}$/.test(addressZip)) af.zip = "ZIP is 4 digits.";
  mergeFields(fields, "deliveryAddress", af);

  const notesRaw = root.notes;
  const notes = typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim().slice(0, 5000) : null;

  const rawLines = root.lines;
  const lines: ParsedLine[] = [];
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    fields.lines = "At least one line is required.";
  } else if (rawLines.length > 100) {
    fields.lines = "At most 100 lines per order.";
  } else {
    rawLines.forEach((raw, i) => {
      const line = asRecord(raw) ?? {};
      const lf: Record<string, string> = {};
      const skuRaw = line.sku;
      const sku = skuRaw == null ? null : typeof skuRaw === "string" && skuRaw.trim() ? skuRaw.trim().slice(0, 60) : null;
      if (typeof skuRaw === "string" && skuRaw.trim().length > 60) lf.sku = "Keep it under 60 characters.";
      const title = reqString(line, "title", 500, lf);
      const qty = moneyString(line, "qty", lf);
      if (toHundredths(qty) === 0n && !lf.qty) lf.qty = "Must be more than 0.";
      const unit = reqString(line, "unit", 30, lf);
      const unitPrice = moneyString(line, "unitPrice", lf);
      let termEndDate: Date | null = null;
      const termRaw = line.termEndDate;
      if (termRaw != null) {
        if (typeof termRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(termRaw)) {
          const d = new Date(`${termRaw}T00:00:00.000Z`);
          if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === termRaw) termEndDate = d;
          else lf.termEndDate = "Use a real YYYY-MM-DD date.";
        } else {
          lf.termEndDate = "Use YYYY-MM-DD or null.";
        }
      }
      // Line total in centavos: qty(x100) x price(cents) is 1/100-cent
      // units; round half-up to whole centavos.
      const lineHundredths = ((toHundredths(qty) as bigint) * (toHundredths(unitPrice) as bigint) + 50n) / 100n;
      mergeFields(fields, `lines.${i}`, lf);
      lines.push({ sku, title, qty, unit, unitPrice, lineTotal: fromHundredths(lineHundredths), termEndDate });
    });
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(400, "validation", "Fix the fields marked below.", fields);
  }

  // The money rule: line totals + deliveryFee = amountPaid, exactly.
  const linesTotal = lines.reduce((sum, l) => sum + (toHundredths(l.lineTotal) as bigint), 0n);
  if (linesTotal + (toHundredths(deliveryFee) as bigint) !== (toHundredths(amountPaid) as bigint)) {
    throw new ApiError(
      400,
      "amount_mismatch",
      `Line totals (${fromHundredths(linesTotal)}) + delivery fee (${deliveryFee}) do not equal amountPaid (${amountPaid}). Nothing was recorded.`,
    );
  }

  return {
    gatewayName,
    gatewayPaymentRef,
    gatewayPaymentKey,
    paidAt,
    amountPaid,
    gatewayFee,
    deliveryFee,
    buyerName,
    buyerEmail,
    buyerPhone,
    addressLabel: addressLabelRaw || null,
    addressStreet,
    addressBarangay,
    addressCityMunicipality,
    addressProvince,
    addressZip,
    notes,
    lines,
  };
}

type LineMatch = { itemId: string | null; matchFlag: "MAPPED" | "NO_MATCH" | "AMBIGUOUS" };

/** SKU → item mapping: exactly one ACTIVE item with the SKU, else flagged. */
async function matchLines(tx: Tx, lines: ParsedLine[]): Promise<LineMatch[]> {
  const skus = [...new Set(lines.map((l) => l.sku).filter((s): s is string => s != null))];
  const bySku = new Map<string, string[]>();
  if (skus.length > 0) {
    const items = await tx.item.findMany({ where: { sku: { in: skus }, active: true }, select: { id: true, sku: true } });
    for (const item of items) {
      if (!item.sku) continue;
      const list = bySku.get(item.sku) ?? [];
      list.push(item.id);
      bySku.set(item.sku, list);
    }
  }
  return lines.map((l) => {
    if (l.sku == null) return { itemId: null, matchFlag: "NO_MATCH" as const };
    const hits = bySku.get(l.sku) ?? [];
    if (hits.length === 1) return { itemId: hits[0] as string, matchFlag: "MAPPED" as const };
    return { itemId: null, matchFlag: hits.length === 0 ? ("NO_MATCH" as const) : ("AMBIGUOUS" as const) };
  });
}

/**
 * Buyer match PROPOSAL (never an attachment): Contact.email → Contact.phone →
 * exact customer name. Exactly one distinct customer wins; anything else
 * proposes nothing and staff pick or create at conversion.
 */
async function proposeMatch(
  tx: Tx,
  buyer: { name: string; email: string; phone: string },
): Promise<{ customerId: string | null; contactId: string | null }> {
  const byContact = async (where: { email: string } | { phone: string }) => {
    const contacts = await tx.contact.findMany({
      where: { ...where, customerId: { not: null }, active: true, archivedAt: null },
      select: { id: true, customerId: true },
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
      take: 10,
    });
    const customerIds = [...new Set(contacts.map((c) => c.customerId as string))];
    if (customerIds.length !== 1) return null;
    const first = contacts.find((c) => c.customerId === customerIds[0]);
    return { customerId: customerIds[0] as string, contactId: first?.id ?? null };
  };
  const byEmail = await byContact({ email: buyer.email });
  if (byEmail) return byEmail;
  const byPhone = await byContact({ phone: buyer.phone });
  if (byPhone) return byPhone;
  const customers = await tx.customer.findMany({
    where: { name: buyer.name, active: true, archivedAt: null },
    select: { id: true },
    take: 2,
  });
  if (customers.length === 1) return { customerId: customers[0]?.id as string, contactId: null };
  // Finding 1364: near-name fallback — a buyer whose name is a typo away
  // from exactly one existing customer gets that customer proposed, so the
  // convert dialog warns instead of staff silently creating a near-duplicate.
  const all = await tx.customer.findMany({
    where: { active: true, archivedAt: null },
    select: { id: true, name: true, active: true },
  });
  const near = findNearNameMatches(all, buyer.name);
  if (near.length === 1) return { customerId: near[0]?.id as string, contactId: null };
  return { customerId: null, contactId: null };
}

function manilaYear(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric" }).format(d));
}

const orderSelect = { id: true, number: true, status: true } as const;

/**
 * Receive one paid web order. Returns the created record, or the existing
 * record with duplicate: true when the gateway key was already received.
 */
export async function createStoreOrderFromApi(
  body: unknown,
  actor: ApiActor,
  deps: IntakeDeps = {},
): Promise<StoreOrderIntakeResult> {
  const parsed = parseIntake(body);

  const existing = await db.storeOrder.findUnique({ where: { gatewayPaymentKey: parsed.gatewayPaymentKey }, select: orderSelect });
  if (existing) return { order: existing, duplicate: true };

  const { settings } = await getSettingsSnapshot();
  const format = settings.numbering.storeOrder;
  const year = manilaYear(parsed.paidAt);
  await ensureSeries(db, "STORE_ORDER", year, format);

  let created: { id: string; number: string; status: StoreOrderStatus } | null = null;
  let madeByMe = false;
  try {
    created = await db.$transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent post of the same
      // gateway key must not create a second order.
      const dupe = await tx.storeOrder.findUnique({ where: { gatewayPaymentKey: parsed.gatewayPaymentKey }, select: orderSelect });
      if (dupe) return dupe;
      const number = await allocateDocNumber(tx, "STORE_ORDER", year, format);
      const matches = await matchLines(tx, parsed.lines);
      const proposal = await proposeMatch(tx, { name: parsed.buyerName, email: parsed.buyerEmail, phone: parsed.buyerPhone });
      const order = await tx.storeOrder.create({
        data: {
          number,
          status: "PAID",
          gatewayName: parsed.gatewayName,
          gatewayPaymentRef: parsed.gatewayPaymentRef,
          gatewayPaymentKey: parsed.gatewayPaymentKey,
          amountPaid: parsed.amountPaid,
          gatewayFee: parsed.gatewayFee,
          deliveryFee: parsed.deliveryFee,
          currency: "PHP",
          buyerName: parsed.buyerName,
          buyerEmail: parsed.buyerEmail,
          buyerPhone: parsed.buyerPhone,
          addressLabel: parsed.addressLabel,
          addressStreet: parsed.addressStreet,
          addressBarangay: parsed.addressBarangay,
          addressCityMunicipality: parsed.addressCityMunicipality,
          addressProvince: parsed.addressProvince,
          addressZip: parsed.addressZip,
          buyerNotes: parsed.notes,
          paidAt: parsed.paidAt,
          matchedCustomerId: proposal.customerId,
          matchedContactId: proposal.contactId,
          lines: {
            create: parsed.lines.map((l, i) => ({
              sortOrder: i,
              sku: l.sku,
              itemId: matches[i]?.itemId ?? null,
              matchFlag: matches[i]?.matchFlag ?? "NO_MATCH",
              title: l.title,
              qty: l.qty,
              unit: l.unit,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              termEndDate: l.termEndDate,
            })),
          },
        },
        select: orderSelect,
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "StoreOrder",
        entityId: order.id,
        action: "create",
        after: {
          number: order.number,
          status: order.status,
          gatewayName: parsed.gatewayName,
          gatewayPaymentRef: parsed.gatewayPaymentRef,
          amountPaid: parsed.amountPaid,
          gatewayFee: parsed.gatewayFee,
          deliveryFee: parsed.deliveryFee,
          lineCount: parsed.lines.length,
          matchedCustomerId: proposal.customerId,
        },
        diff: false,
      });
      madeByMe = true;
      return order;
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost a race on the gateway key: the winning record is the answer.
    const winner = await db.storeOrder.findUnique({ where: { gatewayPaymentKey: parsed.gatewayPaymentKey }, select: orderSelect });
    if (!winner) throw e;
    return { order: winner, duplicate: true };
  }
  if (!created) throw new ApiError(500, "internal", "Something went wrong.");
  if (madeByMe) {
    await sendStoreOrderConfirmation(created.id, deps);
  }
  return { order: created, duplicate: !madeByMe };
}

/**
 * Send the buyer the order-confirmation email. Runs AFTER the intake
 * transaction commits; a failure here never fails the intake. Following the
 * statement-reminder pattern: skip silently when mail is unconfigured, a
 * duplicate-send window guard, and the outcome is audited. A retried POST
 * can never re-send: duplicates return before this is reached, and the
 * window guard covers a manual re-invoke.
 */
export async function sendStoreOrderConfirmation(orderId: string, deps: IntakeDeps = {}): Promise<{ sent: boolean; reason?: string }> {
  try {
    if (!(deps.configured ?? emailConfigured())) return { sent: false, reason: "not_configured" };
    const order = await db.storeOrder.findUnique({
      where: { id: orderId },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    if (!order) return { sent: false, reason: "not_found" };
    const to = order.buyerEmail.trim();
    if (!to || !isValidEmail(to)) return { sent: false, reason: "no_recipient" };
    const now = deps.now ?? new Date();
    const prior = await db.auditLog.findFirst({
      where: {
        entityType: "StoreOrder",
        entityId: order.id,
        action: "send_email",
        at: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (prior) return { sent: false, reason: "duplicate" };
    const { settings } = await getSettingsSnapshot();
    const draft = storeOrderConfirmationEmail(
      {
        buyerName: order.buyerName,
        number: order.number,
        amountPaid: order.amountPaid.toFixed(2),
        deliveryFee: order.deliveryFee.toFixed(2),
        lines: order.lines.map((l) => ({
          title: l.title,
          qty: l.qty.toFixed(2),
          unit: l.unit,
          unitPrice: l.unitPrice.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
        })),
      },
      emailIdentity(settings),
    );
    const subject = sanitizeHeaderValue(draft.subject);
    await (deps.mailer ?? getMailer()).send({ to, subject, text: draft.text, html: draft.html });
    await writeAudit(db, {
      userId: null,
      entityType: "StoreOrder",
      entityId: order.id,
      action: "send_email",
      after: { to, subject, confirmationEmail: "sent" },
      diff: false,
    });
    return { sent: true };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[store-orders] confirmation email failed name=${name}`);
    try {
      await writeAudit(db, {
        userId: null,
        entityType: "StoreOrder",
        entityId: orderId,
        action: "send_email",
        after: { confirmationEmail: "failed" },
        diff: false,
      });
    } catch {
      // Auditing the failure must never throw either.
    }
    return { sent: false, reason: "send_failed" };
  }
}
