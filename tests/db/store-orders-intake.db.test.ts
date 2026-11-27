// Store-order intake (Slice 1) against MySQL 8 (TEST_DATABASE_URL): the
// POST /api/v1/store-orders contract end to end — happy path with WO
// allocation, transport replay, permanent gateway-key dedupe, conflict,
// the amount rule, SKU flags, match proposals, and the confirmation email.
// Keys are generated at runtime; nothing here is a real secret.

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  process.env.API_KEY_PEPPER = Buffer.from(bytes).toString("hex");
  return { hasDb: !!url };
});

import { POST as postStoreOrder } from "@/app/api/v1/store-orders/route";
import { generateApiKey } from "@/lib/api/keys";
import { db } from "@/lib/db";
import { createStoreOrderFromApi, sendStoreOrderConfirmation } from "@/lib/store-orders/intake";
import type { Mailer } from "@/lib/mailer";
import { makeUser, tag } from "./fixtures";

async function issueKey(userId: string, scopes: string[]) {
  const generated = generateApiKey();
  const row = await db.apiKey.create({
    data: {
      name: `Test key ${tag()}`,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      scopes,
      actingUserId: userId,
    },
  });
  return { id: row.id, token: generated.token };
}

function request(token: string | null, body: unknown, idem: string | null) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  if (idem) headers.set("idempotency-key", idem);
  return new NextRequest("http://localhost/api/v1/store-orders", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function orderBody(t: string, overrides: Record<string, unknown> = {}) {
  return {
    gateway: { name: "TestPay", paymentRef: `pay-${t}`, idempotencyKey: `gw-${t}` },
    paidAt: "2026-11-27T02:00:00.000Z",
    amountPaid: "1150.00",
    gatewayFee: "17.25",
    deliveryFee: "150.00",
    currency: "PHP",
    buyer: { name: `Web Buyer ${t}`, email: `buyer-${t}@example.com`, phone: "09171234567" },
    deliveryAddress: {
      label: "Home",
      street: "1 Test St",
      barangay: "Brgy Test",
      cityMunicipality: "Pasig",
      province: "Metro Manila",
      zip: "1600",
    },
    lines: [{ sku: null, title: "Test Widget", qty: "2", unit: "pc", unitPrice: "500.00", termEndDate: null }],
    ...overrides,
  };
}

async function staffKey(scopes: string[] = ["store-orders:write"]) {
  const staff = await makeUser("staff");
  return issueKey(staff.id, scopes);
}

describe("store-orders intake", () => {
  it("lands a paid order: record, lines, WO number from the series", async () => {
    if (!env.hasDb) return;
    const key = await staffKey();
    const t = tag();
    const res = await postStoreOrder(request(key.token, orderBody(t), `idem-${t}`));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; data: { storeOrder: { id: string; number: string; status: string; duplicate: boolean } } };
    expect(json.ok).toBe(true);
    expect(json.data.storeOrder.duplicate).toBe(false);
    expect(json.data.storeOrder.status).toBe("PAID");
    expect(json.data.storeOrder.number).toMatch(/^WO-2026-\d{4}$/);

    const row = await db.storeOrder.findUnique({
      where: { id: json.data.storeOrder.id },
      include: { lines: true },
    });
    expect(row?.gatewayPaymentKey).toBe(`gw-${t}`);
    expect(row?.amountPaid.toFixed(2)).toBe("1150.00");
    expect(row?.gatewayFee.toFixed(2)).toBe("17.25");
    expect(row?.lines).toHaveLength(1);
    expect(row?.lines[0]?.lineTotal.toFixed(2)).toBe("1000.00");
    expect(row?.lines[0]?.matchFlag).toBe("NO_MATCH");

    const series = await db.documentSeries.findFirst({ where: { docType: "STORE_ORDER", year: 2026 } });
    expect(series).not.toBeNull();
    const audit = await db.auditLog.findFirst({ where: { entityType: "StoreOrder", entityId: row?.id, action: "create" } });
    expect(audit).not.toBeNull();
  });

  it("replays the stored 201 for the same transport key and body", async () => {
    if (!env.hasDb) return;
    const key = await staffKey();
    const t = tag();
    const body = orderBody(t);
    const first = await postStoreOrder(request(key.token, body, `idem-${t}`));
    expect(first.status).toBe(201);
    const second = await postStoreOrder(request(key.token, body, `idem-${t}`));
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotency-replayed")).toBe("true");
    const count = await db.storeOrder.count({ where: { gatewayPaymentKey: `gw-${t}` } });
    expect(count).toBe(1);
  });

  it("dedupes permanently on the gateway key under a fresh transport key", async () => {
    if (!env.hasDb) return;
    const key = await staffKey();
    const t = tag();
    const body = orderBody(t);
    const first = await postStoreOrder(request(key.token, body, `idem-a-${t}`));
    expect(first.status).toBe(201);
    const second = await postStoreOrder(request(key.token, body, `idem-b-${t}`));
    expect(second.status).toBe(200);
    const json = (await second.json()) as { data: { storeOrder: { duplicate: boolean; number: string } } };
    expect(json.data.storeOrder.duplicate).toBe(true);
    const count = await db.storeOrder.count({ where: { gatewayPaymentKey: `gw-${t}` } });
    expect(count).toBe(1);
  });

  it("answers 409 when a transport key is reused with a different body", async () => {
    if (!env.hasDb) return;
    const key = await staffKey();
    const t = tag();
    const first = await postStoreOrder(request(key.token, orderBody(t), `idem-${t}`));
    expect(first.status).toBe(201);
    const other = orderBody(`${t}x`);
    const second = await postStoreOrder(request(key.token, other, `idem-${t}`));
    expect(second.status).toBe(409);
    const json = (await second.json()) as { error: { code: string } };
    expect(json.error.code).toBe("idempotency_conflict");
  });

  it("rejects an amount mismatch with 400 amount_mismatch and records nothing", async () => {
    if (!env.hasDb) return;
    const key = await staffKey();
    const t = tag();
    const body = orderBody(t, { amountPaid: "9999.00" });
    const res = await postStoreOrder(request(key.token, body, `idem-${t}`));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("amount_mismatch");
    const count = await db.storeOrder.count({ where: { gatewayPaymentKey: `gw-${t}` } });
    expect(count).toBe(0);
  });

  it("flags SKU lines: mapped, no-match, ambiguous, inactive", async () => {
    if (!env.hasDb) return;
    const t = tag();
    const skuOne = `SKU-ONE-${t}`;
    const skuAmb = `SKU-AMB-${t}`;
    const skuIna = `SKU-INA-${t}`;
    const item = await db.item.create({ data: { name: `Mapped Widget ${t}`, sku: skuOne, unit: "pc" } });
    await db.item.create({ data: { name: `Ambiguous A ${t}`, sku: skuAmb, unit: "pc" } });
    await db.item.create({ data: { name: `Ambiguous B ${t}`, sku: skuAmb, unit: "pc" } });
    await db.item.create({ data: { name: `Inactive ${t}`, sku: skuIna, unit: "pc", active: false } });
    const key = await staffKey();
    const lines = [
      { sku: skuOne, title: "Mapped Widget", qty: "1", unit: "pc", unitPrice: "100.00", termEndDate: null },
      { sku: `SKU-NONE-${t}`, title: "Unknown", qty: "1", unit: "pc", unitPrice: "100.00", termEndDate: null },
      { sku: skuAmb, title: "Ambiguous", qty: "1", unit: "pc", unitPrice: "100.00", termEndDate: null },
      { sku: skuIna, title: "Inactive", qty: "1", unit: "pc", unitPrice: "100.00", termEndDate: null },
    ];
    const body = orderBody(t, { lines, amountPaid: "550.00", deliveryFee: "150.00" });
    const res = await postStoreOrder(request(key.token, body, `idem-${t}`));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { storeOrder: { id: string } } };
    const row = await db.storeOrder.findUnique({
      where: { id: json.data.storeOrder.id },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    expect(row?.lines.map((l) => l.matchFlag)).toEqual(["MAPPED", "NO_MATCH", "AMBIGUOUS", "NO_MATCH"]);
    expect(row?.lines[0]?.itemId).toBe(item.id);
    expect(row?.lines[1]?.itemId).toBeNull();
  });

  it("proposes a customer match by contact email, then phone, then name — never on multiples", async () => {
    if (!env.hasDb) return;
    const t = tag();
    const customer = await db.customer.create({ data: { name: `Match Co ${t}`, withholdingType: "NONE" } });
    const contact = await db.contact.create({
      data: { customerId: customer.id, name: "Buyer Person", email: `person-${t}@example.com`, phone: `0917${t.slice(0, 7)}` },
    });
    const key = await staffKey();

    const byEmail = orderBody(`${t}e`, {
      buyer: { name: "Someone Else", email: `person-${t}@example.com`, phone: "09000000000" },
    });
    const r1 = await postStoreOrder(request(key.token, byEmail, `idem-e-${t}`));
    expect(r1.status).toBe(201);
    const j1 = (await r1.json()) as { data: { storeOrder: { id: string } } };
    const row1 = await db.storeOrder.findUnique({ where: { id: j1.data.storeOrder.id } });
    expect(row1?.matchedCustomerId).toBe(customer.id);
    expect(row1?.matchedContactId).toBe(contact.id);

    const byPhone = orderBody(`${t}p`, {
      buyer: { name: "Someone Else", email: `nobody-${t}@example.com`, phone: `0917${t.slice(0, 7)}` },
    });
    const r2 = await postStoreOrder(request(key.token, byPhone, `idem-p-${t}`));
    const j2 = (await r2.json()) as { data: { storeOrder: { id: string } } };
    const row2 = await db.storeOrder.findUnique({ where: { id: j2.data.storeOrder.id } });
    expect(row2?.matchedCustomerId).toBe(customer.id);

    const byName = orderBody(`${t}n`, {
      buyer: { name: `Match Co ${t}`, email: `nobody2-${t}@example.com`, phone: "09000000001" },
    });
    const r3 = await postStoreOrder(request(key.token, byName, `idem-n-${t}`));
    const j3 = (await r3.json()) as { data: { storeOrder: { id: string } } };
    const row3 = await db.storeOrder.findUnique({ where: { id: j3.data.storeOrder.id } });
    expect(row3?.matchedCustomerId).toBe(customer.id);
    expect(row3?.matchedContactId).toBeNull();

    // Two customers with the same name: no proposal.
    await db.customer.create({ data: { name: `Twin Co ${t}`, withholdingType: "NONE" } });
    await db.customer.create({ data: { name: `Twin Co ${t}`, withholdingType: "NONE" } });
    const twin = orderBody(`${t}t`, {
      buyer: { name: `Twin Co ${t}`, email: `twin-${t}@example.com`, phone: "09000000002" },
    });
    const r4 = await postStoreOrder(request(key.token, twin, `idem-t-${t}`));
    const j4 = (await r4.json()) as { data: { storeOrder: { id: string } } };
    const row4 = await db.storeOrder.findUnique({ where: { id: j4.data.storeOrder.id } });
    expect(row4?.matchedCustomerId).toBeNull();
  });

  it("refuses keys without the scope, and acting users without edit_data", async () => {
    if (!env.hasDb) return;
    const t = tag();
    const staff = await makeUser("staff");
    const noScope = await issueKey(staff.id, ["items:read"]);
    const r1 = await postStoreOrder(request(noScope.token, orderBody(t), `idem-${t}`));
    expect(r1.status).toBe(403);
    const viewer = await makeUser("viewer");
    const viewerKey = await issueKey(viewer.id, ["store-orders:write"]);
    const r2 = await postStoreOrder(request(viewerKey.token, orderBody(`${t}v`), `idem-v-${t}`));
    expect(r2.status).toBe(403);
    const r3 = await postStoreOrder(request(null, orderBody(`${t}n`), `idem-n-${t}`));
    expect(r3.status).toBe(401);
  });

  it("sends the confirmation email once, after commit, and audits it", async () => {
    if (!env.hasDb) return;
    const t = tag();
    const staff = await makeUser("staff");
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer: Mailer = {
      async send(mail) {
        sent.push(mail);
      },
    };
    const result = await createStoreOrderFromApi(orderBody(t), staff, { configured: true, mailer });
    expect(result.duplicate).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(`buyer-${t}@example.com`);
    expect(sent[0]?.subject).toContain(result.order.number);
    expect(sent[0]?.text).toContain("1,150.00");
    expect(sent[0]?.text).not.toContain("17.25");

    const audit = await db.auditLog.findFirst({
      where: { entityType: "StoreOrder", entityId: result.order.id, action: "send_email" },
    });
    expect(audit).not.toBeNull();

    // The duplicate-send window guard: a second invoke inside the window
    // sends nothing.
    const again = await sendStoreOrderConfirmation(result.order.id, { configured: true, mailer });
    expect(again.sent).toBe(false);
    expect(again.reason).toBe("duplicate");
    expect(sent).toHaveLength(1);

    // A service-level re-post of the same gateway key is a duplicate and
    // sends nothing either.
    const dupe = await createStoreOrderFromApi(orderBody(t), staff, { configured: true, mailer });
    expect(dupe.duplicate).toBe(true);
    expect(dupe.order.id).toBe(result.order.id);
    expect(sent).toHaveLength(1);
  });

  it("skips the email silently when mail is not configured", async () => {
    if (!env.hasDb) return;
    const t = tag();
    const staff = await makeUser("staff");
    const sent: unknown[] = [];
    const mailer: Mailer = {
      async send(mail) {
        sent.push(mail);
      },
    };
    const result = await createStoreOrderFromApi(orderBody(t), staff, { configured: false, mailer });
    expect(result.duplicate).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("allocates consecutive WO numbers within a run", async () => {
    if (!env.hasDb) return;
    const staff = await makeUser("staff");
    const a = await createStoreOrderFromApi(orderBody(`${tag()}a`), staff, { configured: false });
    const b = await createStoreOrderFromApi(orderBody(`${tag()}b`), staff, { configured: false });
    const seq = (n: string) => Number(n.split("-").at(-1));
    expect(b.order.number.slice(0, 8)).toBe(a.order.number.slice(0, 8));
    expect(seq(b.order.number)).toBe(seq(a.order.number) + 1);
  });
});
