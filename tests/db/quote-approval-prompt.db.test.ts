// Prompt model for quote approval (final-check finding F5, Jerwin's decision
// 2026-11-18): a quote that trips no approval threshold is NOT_REQUIRED and
// sends/converts with no approval step. A quote WITH reasons stays PENDING:
// Staff-only users keep waiting, an Approver/Admin must confirm the prompt
// (confirmedWarnings) — the confirmation approves the quote and is recorded
// in the audit log. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import {
  approveQuote,
  convertQuoteToSalesOrder,
  createQuote,
  markQuoteSent,
  updateQuote,
  type DocActor,
} from "@/lib/services/quotes";
import type { QuoteInput } from "@/lib/validation/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

describe.skipIf(!env.hasDb)("quote approval prompt model (MySQL)", () => {
  let approver: DocActor;
  let staff: DocActor;
  let totalAbove = 0;
  let marginBelowPct = 0;

  beforeAll(async () => {
    approver = await makeUser("costs");
    staff = await makeUser("staff");
    const snap = await getSettingsSnapshot();
    totalAbove = Number(snap.settings.approval.totalAbove);
    marginBelowPct = Number(snap.settings.approval.marginBelowPct);
    // The cases below are built relative to the live thresholds; fail loudly
    // if the test DB's defaults ever move outside the assumed shape.
    expect(totalAbove).toBeGreaterThan(10_000);
    expect(marginBelowPct).toBeGreaterThan(0);
    expect(marginBelowPct).toBeLessThan(90);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** One line, fat margin, small total: trips nothing. */
  function cleanInput(customerId: string, year: number): QuoteInput {
    return quoteInput(customerId, year, {
      items: [
        { id: null, description: "Clean line", kind: "GOODS", qty: "1", unit: "pc", supplierId: null, supplierUnitCost: "100", unitPrice: "1000" },
      ],
    });
  }

  /** Total above the limit AND margin below the floor: trips both. */
  function riskyInput(customerId: string, year: number): QuoteInput {
    const price = String(totalAbove + 100_000);
    return quoteInput(customerId, year, {
      items: [
        { id: null, description: "Risky line", kind: "GOODS", qty: "1", unit: "pc", supplierId: null, supplierUnitCost: price, unitPrice: price },
      ],
    });
  }

  it("a clean quote is NOT_REQUIRED and staff can send it with no approval step", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const quote = await createQuote(cleanInput(customer.id, year), approver);
    expect(quote.approvalStatus).toBe("NOT_REQUIRED");

    const sent = await markQuoteSent(quote.id, staff);
    expect(sent.status).toBe("SENT");
  });

  it("a risky quote waits: staff refused, approver must confirm, confirmation is audited", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const quote = await createQuote(riskyInput(customer.id, year), approver);
    expect(quote.approvalStatus).toBe("PENDING");

    await expect(markQuoteSent(quote.id, staff)).rejects.toMatchObject({
      name: "DocRuleError",
      message: expect.stringMatching(/waiting for approval/i),
    });
    await expect(markQuoteSent(quote.id, approver)).rejects.toMatchObject({
      name: "DocRuleError",
      message: expect.stringMatching(/needs approval:.*Total is above the approval limit/),
    });

    const sent = await markQuoteSent(quote.id, approver, { confirmedWarnings: true });
    expect(sent.status).toBe("SENT");
    expect(sent.approvalStatus).toBe("APPROVED");
    expect(sent.approvedById).toBe(approver.id);

    const audits = await db.auditLog.findMany({ where: { entityType: "Quote", entityId: quote.id } });
    const overrideEntry = audits.find((a) => JSON.stringify(a.after ?? {}).includes("approvalOverride"));
    expect(overrideEntry).toBeTruthy();
    expect(JSON.stringify(overrideEntry!.after)).toContain("Total is above the approval limit");
  });

  it("convert follows the same prompt: staff refused, approver confirms, quote lands WON + APPROVED", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const addressId = await customerDeliveryAddressId(customer.id);
    const quote = await createQuote(riskyInput(customer.id, year), approver);
    const input = { buyerPoNo: "TEST-PROMPT-PO", deliveryAddressId: addressId };

    await expect(convertQuoteToSalesOrder(quote.id, input, staff)).rejects.toMatchObject({
      message: expect.stringMatching(/waiting for approval/i),
    });
    await expect(convertQuoteToSalesOrder(quote.id, input, approver)).rejects.toMatchObject({
      message: expect.stringMatching(/needs approval:/),
    });

    const so = await convertQuoteToSalesOrder(quote.id, input, approver, { confirmedWarnings: true });
    expect(so.number).toMatch(/^SO-/);
    const after = await db.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe("WON");
    expect(after.approvalStatus).toBe("APPROVED");
    expect(after.approvedById).toBe(approver.id);
  });

  it("a quote with no supplier cost always needs approval, however small", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const quote = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          { id: null, description: "No cost line", kind: "GOODS", qty: "1", unit: "pc", supplierId: null, supplierUnitCost: "", unitPrice: "100" },
        ],
      }),
      approver,
    );
    expect(quote.approvalStatus).toBe("PENDING");
    await expect(markQuoteSent(quote.id, staff)).rejects.toMatchObject({
      message: expect.stringMatching(/waiting for approval/i),
    });
  });

  it("money edits move the state both ways; non-money edits leave it alone", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();

    // Clean → risky money edit: NOT_REQUIRED falls back to PENDING.
    const clean = await createQuote(cleanInput(customer.id, year), approver);
    expect(clean.approvalStatus).toBe("NOT_REQUIRED");
    const madeRisky = await updateQuote(clean.id, riskyInput(customer.id, year), approver);
    expect(madeRisky.approvalStatus).toBe("PENDING");

    // Risky → clean money edit: PENDING clears to NOT_REQUIRED.
    const madeClean = await updateQuote(clean.id, cleanInput(customer.id, year), approver);
    expect(madeClean.approvalStatus).toBe("NOT_REQUIRED");

    // Notes-only edit: state untouched.
    const noted = await updateQuote(clean.id, { ...cleanInput(customer.id, year), notes: "just a note" }, approver);
    expect(noted.approvalStatus).toBe("NOT_REQUIRED");

    // Approved quote, risky money edit: back to PENDING (the old reset).
    const risky = await createQuote(riskyInput(customer.id, year), approver);
    await approveQuote(risky.id, approver);
    const edited = await updateQuote(risky.id, riskyInput(customer.id, year), approver);
    expect(edited.approvalStatus).toBe("PENDING");
  });

  it("approving a NOT_REQUIRED quote is refused — there is nothing to approve", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const quote = await createQuote(cleanInput(customer.id, year), approver);
    await expect(approveQuote(quote.id, approver)).rejects.toMatchObject({
      message: expect.stringMatching(/doesn't need approval/i),
    });
  });
});
