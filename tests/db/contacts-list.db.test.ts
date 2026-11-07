// The /contacts directory query (listAllContacts) against MySQL 8
// (TEST_DATABASE_URL). Assertions are by row id — the test DB is shared
// with other suites, so never assert global counts.

import { beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { listAllContacts } from "@/lib/services/contacts";
import { makeCustomer, makeSupplier, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("contacts directory list (MySQL)", () => {
  const marker = tag();
  let customerId = "";
  let supplierId = "";
  let customerName = "";
  let supplierName = "";
  let activeCustomerContactId = "";
  let inactiveCustomerContactId = "";
  let activeSupplierContactId = "";

  beforeAll(async () => {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    customerId = customer.id;
    supplierId = supplier.id;
    customerName = customer.name;
    supplierName = supplier.name;
    const a = await db.contact.create({
      data: { customerId, name: `${marker} Ana`, email: `${marker}@example.test`, phone: "09170000001", active: true, isMain: true },
    });
    activeCustomerContactId = a.id;
    const b = await db.contact.create({
      data: { customerId, name: `${marker} Ben`, active: false },
    });
    inactiveCustomerContactId = b.id;
    const c = await db.contact.create({
      data: { supplierId, name: `${marker} Cora`, phone: "09170000002", active: true },
    });
    activeSupplierContactId = c.id;
  });

  it("lists active contacts from both owners with the company name, hiding inactive by default", async () => {
    const rows = await listAllContacts({ q: marker });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(activeCustomerContactId);
    expect(ids).toContain(activeSupplierContactId);
    expect(ids).not.toContain(inactiveCustomerContactId);
    expect(rows.find((r) => r.id === activeCustomerContactId)?.ownerName).toBe(customerName);
    expect(rows.find((r) => r.id === activeSupplierContactId)?.ownerName).toBe(supplierName);
  });

  it("includes inactive contacts when asked", async () => {
    const rows = await listAllContacts({ q: marker, showInactive: true });
    expect(rows.map((r) => r.id)).toContain(inactiveCustomerContactId);
  });

  it("finds contacts by the owner company name", async () => {
    const byCustomer = await listAllContacts({ q: customerName });
    expect(byCustomer.map((r) => r.id)).toContain(activeCustomerContactId);
    const bySupplier = await listAllContacts({ q: supplierName });
    expect(bySupplier.map((r) => r.id)).toContain(activeSupplierContactId);
  });

  it("finds contacts by email fragment", async () => {
    const rows = await listAllContacts({ q: `${marker}@example` });
    expect(rows.map((r) => r.id)).toEqual([activeCustomerContactId]);
  });
});
