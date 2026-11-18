// Stale-edit guard for quotes (final-check finding F3): updateQuote refuses a
// save whose loaded updatedAt no longer matches the stored row — the same
// guard updateSalesOrder / updatePurchaseOrder already carry — leaves the
// row unchanged, and still accepts a fresh token. Runs on MySQL 8
// (TEST_DATABASE_URL); skipped locally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { STALE_EDIT_MESSAGE_QUOTE } from "@/lib/documents/common";
import { createQuote, updateQuote, type DocActor } from "@/lib/services/quotes";
import type { QuoteInput } from "@/lib/validation/quotes";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput } from "./fixtures";

describe.skipIf(!env.hasDb)("stale-edit guard for quotes (MySQL)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function seedQuote() {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const quote = await createQuote(quoteInput(customer.id, year, {}, supplier.id), admin);
    return { quote, customer, year, supplier };
  }

  function payload(customerId: string, year: number, supplierId: string, updatedAt: string | undefined, notes: string): QuoteInput {
    return quoteInput(customerId, year, { updatedAt, notes }, supplierId);
  }

  it("accepts a fresh token, refuses a stale one, and leaves the row unchanged on refusal", async () => {
    const { quote, customer, year, supplier } = await seedQuote();
    const loaded = await db.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const token = loaded.updatedAt.toISOString();

    // Fresh token: the save lands.
    const saved = await updateQuote(quote.id, payload(customer.id, year, supplier.id, token, "first save"), admin);
    expect(saved.notes).toBe("first save");

    // The same token is now stale: refused with the quote stale message.
    await expect(
      updateQuote(quote.id, payload(customer.id, year, supplier.id, token, "stale save"), admin),
    ).rejects.toMatchObject({ name: "DocRuleError", message: STALE_EDIT_MESSAGE_QUOTE });

    // The refusal changed nothing.
    const after = await db.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.notes).toBe("first save");

    // A fresh token works again.
    const saved2 = await updateQuote(
      quote.id,
      payload(customer.id, year, supplier.id, after.updatedAt.toISOString(), "second save"),
      admin,
    );
    expect(saved2.notes).toBe("second save");
  });
});
