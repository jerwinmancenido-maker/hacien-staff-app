// Quote delivery address pick (2026-11-08) against a real MySQL 8 database (TEST_DATABASE_URL).
// The quote carries one of the customer's saved addresses plus a text
// snapshot; later address edits never change the saved quote.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { copyQuote, createQuote, updateQuote, type DocActor } from "@/lib/services/quotes";
import { getQuotePrintModel } from "@/lib/print/views";
import { getQuoteView } from "@/lib/quotes/views";
import { formatAddress } from "@/lib/addresses/format";
import { freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

describe.skipIf(!hasDb)("quote delivery address pick (MySQL)", () => {
  let actor: DocActor;
  let year: number;

  beforeAll(async () => {
    actor = await makeUser("costs");
    year = await freshYear();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeAddress(customerId: string, street: string, opts: { isDefault?: boolean; archived?: boolean } = {}) {
    return db.address.create({
      data: {
        customerId,
        kind: "DELIVERY",
        label: "Site",
        street,
        barangay: "San Antonio",
        cityMunicipality: "Pasig City",
        province: "Metro Manila",
        zip: "1605",
        isDefault: opts.isDefault ?? false,
        archivedAt: opts.archived ? new Date() : null,
      },
    });
  }

  it("create with a pick stores the id and the text snapshot; print and view use it", async () => {
    const customer = await makeCustomer();
    const addr = await makeAddress(customer.id, "123 Pick Street");
    const q = await createQuote(quoteInput(customer.id, year, { deliveryAddressId: addr.id }), actor);
    expect(q.deliveryAddressId).toBe(addr.id);
    expect(q.deliveryAddressText).toBe(formatAddress(addr, { multiline: true }));

    const { doc } = (await getQuotePrintModel(q.id))!;
    expect(doc.party.deliveryAddress).toBe(q.deliveryAddressText);

    const view = await getQuoteView(q.id, actor);
    expect(view?.deliveryAddressId).toBe(addr.id);
    expect(view?.deliveryAddressText).toBe(q.deliveryAddressText);
  });

  it("create with another customer's address is rejected", async () => {
    const customer = await makeCustomer();
    const other = await makeCustomer();
    const foreign = await makeAddress(other.id, "999 Foreign Road");
    await expect(createQuote(quoteInput(customer.id, year, { deliveryAddressId: foreign.id }), actor)).rejects.toBeInstanceOf(
      DocRuleError,
    );
  });

  it("create with an archived address is rejected", async () => {
    const customer = await makeCustomer();
    const archived = await makeAddress(customer.id, "1 Archived Lane", { archived: true });
    await expect(createQuote(quoteInput(customer.id, year, { deliveryAddressId: archived.id }), actor)).rejects.toBeInstanceOf(
      DocRuleError,
    );
  });

  it("create with no pick stores nulls and the print falls back to the customer's default delivery address", async () => {
    const customer = await makeCustomer();
    const def = await makeAddress(customer.id, "77 Default Avenue", { isDefault: true });
    const q = await createQuote(quoteInput(customer.id, year), actor);
    expect(q.deliveryAddressId).toBeNull();
    expect(q.deliveryAddressText).toBeNull();
    const { doc } = (await getQuotePrintModel(q.id))!;
    expect(doc.party.deliveryAddress).toBe(formatAddress(def, { multiline: true }));
  });

  it("snapshot proof: editing the address afterwards changes neither the stored quote nor same-pick re-saves", async () => {
    const customer = await makeCustomer();
    const addr = await makeAddress(customer.id, "10 Original Street");
    const q = await createQuote(quoteInput(customer.id, year, { deliveryAddressId: addr.id }), actor);
    const snapshot = q.deliveryAddressText;

    await db.address.update({ where: { id: addr.id }, data: { street: "20 Edited Street" } });

    const { doc } = (await getQuotePrintModel(q.id))!;
    expect(doc.party.deliveryAddress).toBe(snapshot);
    expect(doc.party.deliveryAddress).not.toContain("Edited");

    // Re-saving with the SAME pick keeps the original snapshot text.
    const updated = await updateQuote(q.id, quoteInput(customer.id, year, { deliveryAddressId: addr.id }), actor);
    expect(updated.deliveryAddressText).toBe(snapshot);
  });

  it("changing the pick re-snapshots; clearing the pick nulls both fields; omitting the field keeps the pick", async () => {
    const customer = await makeCustomer();
    const first = await makeAddress(customer.id, "1 First Street");
    const second = await makeAddress(customer.id, "2 Second Street");
    const q = await createQuote(quoteInput(customer.id, year, { deliveryAddressId: first.id }), actor);

    const changed = await updateQuote(q.id, quoteInput(customer.id, year, { deliveryAddressId: second.id }), actor);
    expect(changed.deliveryAddressId).toBe(second.id);
    expect(changed.deliveryAddressText).toBe(formatAddress(second, { multiline: true }));

    // Omitted field (older callers) → the stored pick survives the save.
    const omitted = quoteInput(customer.id, year, { deliveryAddressId: second.id });
    delete omitted.deliveryAddressId;
    const kept = await updateQuote(q.id, omitted, actor);
    expect(kept.deliveryAddressId).toBe(second.id);
    expect(kept.deliveryAddressText).toBe(formatAddress(second, { multiline: true }));

    const cleared = await updateQuote(q.id, quoteInput(customer.id, year, { deliveryAddressId: null }), actor);
    expect(cleared.deliveryAddressId).toBeNull();
    expect(cleared.deliveryAddressText).toBeNull();
  });

  it("copyQuote carries the pick and its snapshot", async () => {
    const customer = await makeCustomer();
    const addr = await makeAddress(customer.id, "5 Copy Street");
    const q = await createQuote(quoteInput(customer.id, year, { deliveryAddressId: addr.id }), actor);
    const copy = await copyQuote(q.id, actor, 1);
    expect(copy.deliveryAddressId).toBe(addr.id);
    expect(copy.deliveryAddressText).toBe(q.deliveryAddressText);
  });
});
