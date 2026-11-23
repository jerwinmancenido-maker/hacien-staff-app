// Run-79 fix plan, Fix 1 (F-G): the save-layer Remarks guard — DB truth
// against a real MySQL 8 database (TEST_DATABASE_URL).
//
// The validation half lives in tests/notes-payment-guard.test.ts. This
// file proves the two service paths that copy STORED notes verbatim —
// quote copy and quote→SO conversion — keep propagating legacy notes
// exactly as stored (run-79 fix plan, Fix 1 plan correction 2026-11-23):
// the save-layer guard stands at the validation layer only, so notes
// saved before the guard existed ride copy/convert untouched and are
// never silently rewritten — the PRINT layer strips blocked phrases
// when the document prints (proven by the legacy suites). Clean notes
// copy and convert verbatim too.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { approveQuote, copyQuote, convertQuoteToSalesOrder, createQuote } from "@/lib/services/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

// The print layer's own proof string (run 79, Layer 4).
const BLOCKED_NOTE = "pay COD or 50/50 split, Net 30 if late";
const CLEAN_NOTE = "Deliver to the warehouse gate; call the guard on arrival.";

describe.skipIf(!hasDb)("save-layer notes guard (MySQL)", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-notes-guard-uploads-"));
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** A quote whose stored notes were written directly, as if saved
   * before the guard existed. */
  async function legacyQuoteWithNotes(notes: string) {
    const year = await freshYear();
    const customer = await makeCustomer();
    const q = await createQuote(quoteInput(customer.id, year, { notes: CLEAN_NOTE }), admin);
    await db.quote.update({ where: { id: q.id }, data: { notes } });
    return { customer, quoteId: q.id };
  }

  it("copies a quote whose stored notes carry blocked phrases — verbatim (legacy contract)", async () => {
    const { quoteId } = await legacyQuoteWithNotes(BLOCKED_NOTE);
    const copy = await copyQuote(quoteId, admin, 1);
    expect(copy.notes).toBe(BLOCKED_NOTE);
    // The stored note is never silently rewritten.
    const stored = await db.quote.findUnique({ where: { id: quoteId }, select: { notes: true } });
    expect(stored!.notes).toBe(BLOCKED_NOTE);
  });

  it("converts a quote whose stored notes carry blocked phrases — the SO carries them verbatim (legacy contract)", async () => {
    const { customer, quoteId } = await legacyQuoteWithNotes(BLOCKED_NOTE);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    await convertQuoteToSalesOrder(quoteId, { buyerPoNo: "B-GUARD", deliveryAddressId }, admin);
    expect(await db.salesOrder.count({ where: { quoteId } })).toBe(1);
    const soRow = await db.salesOrder.findFirst({ where: { quoteId }, select: { notes: true } });
    expect(soRow).not.toBeNull();
    expect(soRow!.notes).toBe(BLOCKED_NOTE);
    const stored = await db.quote.findUnique({ where: { id: quoteId }, select: { notes: true, status: true } });
    expect(stored!.notes).toBe(BLOCKED_NOTE);
    expect(stored!.status).toBe("WON");
  });

  it("copies and converts clean notes verbatim (control)", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const q = await createQuote(quoteInput(customer.id, year, { notes: CLEAN_NOTE }), admin);
    const copy = await copyQuote(q.id, admin, 1);
    expect(copy.notes).toBe(CLEAN_NOTE);
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-CLEAN", deliveryAddressId }, admin);
    const soRow = await db.salesOrder.findFirst({ where: { quoteId: q.id }, select: { notes: true } });
    expect(soRow).not.toBeNull();
    expect(soRow!.notes).toBe(CLEAN_NOTE);
  });
});
