// L25 Fix A (Complete Review run 14): listCustomers matches contact phone
// numbers behind a digit gate (at least 4 digits in the query), so a
// contact's number finds its customer in global search, the Customers list
// and /api/v1 — all three call this one function. Archived / inactive
// contacts never match. Name and TIN matching are unchanged.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.
// AUTHORED-BUT-UNRUN at build time: the gate DB route was undecided when
// this batch was built (Mac MySQL 8.4 panics the Prisma engine), so these
// tests first execute at the pre-merge gate.

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { listCustomers } from "@/lib/services/companies";

/** Letters-only suffix: these customers' names can never contain a digit query. */
const letters = () => Array.from(randomBytes(6), (b) => "abcdefghijklmnopqrstuvwxyz"[b % 26]).join("");
const digits4 = () => String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));

type Row = Awaited<ReturnType<typeof listCustomers>>[number];
const contactsOf = (row: Row) =>
  (row as { contacts?: { name: string; phone: string | null }[] }).contacts;

describe.skipIf(!env.hasDb)("customer contact-phone search (MySQL)", () => {
  const sfx = digits4();
  const sharedFragment = `777 ${sfx}`;
  let alphaId = "";
  let archivedId = "";
  let inactiveId = "";
  let tinId = "";
  let alphaName = "";
  let alphaContactName = "";
  const alphaPhone = `0919 777 ${sfx}`;

  beforeAll(async () => {
    const a = await db.customer.create({
      data: { name: `Phone Search Alpha ${letters()}`, withholdingType: "NONE" },
    });
    alphaId = a.id;
    alphaName = a.name;
    alphaContactName = `Alpha Contact ${letters()}`;
    await db.contact.create({
      data: { customerId: a.id, name: alphaContactName, phone: alphaPhone, active: true, isMain: true },
    });

    const b = await db.customer.create({
      data: { name: `Phone Search Archived ${letters()}`, withholdingType: "NONE" },
    });
    archivedId = b.id;
    await db.contact.create({
      data: {
        customerId: b.id,
        name: `Archived Contact ${letters()}`,
        phone: `0918 777 ${sfx}`,
        active: true,
        archivedAt: new Date(),
      },
    });

    const c = await db.customer.create({
      data: { name: `Phone Search Inactive ${letters()}`, withholdingType: "NONE" },
    });
    inactiveId = c.id;
    await db.contact.create({
      data: { customerId: c.id, name: `Inactive Contact ${letters()}`, phone: `0917 777 ${sfx}`, active: false },
    });

    const d = await db.customer.create({
      data: { name: `Phone Search Tin ${letters()}`, withholdingType: "NONE", tin: `777${sfx}111` },
    });
    tinId = d.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("finds the customer by a contact phone fragment, full and partial", async () => {
    const full = await listCustomers({ q: alphaPhone });
    expect(full.map((r) => r.id)).toContain(alphaId);

    const partial = await listCustomers({ q: sharedFragment });
    expect(partial.map((r) => r.id)).toContain(alphaId);
  });

  it("carries the matched contact on the row when the phone clause fired", async () => {
    const rows = await listCustomers({ q: sharedFragment });
    const row = rows.find((r) => r.id === alphaId);
    expect(row).toBeDefined();
    expect(contactsOf(row!)).toEqual([{ name: alphaContactName, phone: alphaPhone }]);
  });

  it("does not match archived or inactive contacts' numbers", async () => {
    const rows = await listCustomers({ q: sharedFragment });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(archivedId);
    expect(ids).not.toContain(inactiveId);
  });

  it("digit gate: a 3-digit query never phone-matches", async () => {
    const rows = await listCustomers({ q: sfx.slice(0, 3) });
    expect(rows.map((r) => r.id)).not.toContain(alphaId);
  });

  it("name matching is unchanged and carries no contact include", async () => {
    const rows = await listCustomers({ q: alphaName.slice(0, 18) });
    const row = rows.find((r) => r.id === alphaId);
    expect(row).toBeDefined();
    expect(contactsOf(row!)).toBeUndefined();
  });

  it("TIN matching is unchanged (query whitespace is stripped)", async () => {
    const rows = await listCustomers({ q: sharedFragment });
    expect(rows.map((r) => r.id)).toContain(tinId);
  });
});
