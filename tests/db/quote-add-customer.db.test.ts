// Brief 09 — Add-customer from quote uses existing customer/contact create paths.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { saveCustomer } from "@/lib/services/companies";
import { addContact } from "@/lib/services/contacts";
import { getSettingsSnapshot } from "@/lib/settings";
import { makeUser, tag } from "./fixtures";

describe.skipIf(!hasDb)("quote add-customer create path (MySQL)", () => {
  let actorId: string;

  beforeAll(async () => {
    const u = await makeUser("staff");
    actorId = u.id;
    await getSettingsSnapshot();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("creates customer + main contact and leaves quote data untouched (no quote writes)", async () => {
    const quotesBefore = await db.quote.count();
    const name = `Inline Customer ${tag()}`;
    const created = await saveCustomer(
      null,
      {
        name,
        tin: null,
        withholdingType: "NONE",
        defaultWithholding: [],
        defaultTerms: null,
        notes: null,
      },
      actorId,
    );
    await db.customer.update({
      where: { id: created.id },
      data: { address: "2F Ayala Center, Cebu Business Park, Cebu City 6000" },
    });
    const contact = await addContact(
      { kind: "customer", id: created.id },
      { name: "Mark Tan", role: null, email: "mark.tan@example.com", phone: null, isMain: true },
      actorId,
    );

    const row = await db.customer.findUnique({
      where: { id: created.id },
      include: { contacts: { where: { active: true } } },
    });
    expect(row?.name).toBe(name);
    expect(row?.address).toContain("Cebu City");
    expect(row?.withholdingType).toBe("NONE");
    expect(contact.isMain).toBe(true);
    expect(row?.contacts.some((c) => c.id === contact.id)).toBe(true);
    // Cancel / save-customer must never mutate quotes.
    expect(await db.quote.count()).toBe(quotesBefore);
  });
});
