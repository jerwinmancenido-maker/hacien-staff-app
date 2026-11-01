// S-18 quote workflow approval against MySQL (TEST_DATABASE_URL).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { DocRuleError } from "@/lib/documents/common";
import {
  approveQuote,
  buildQuoteEmailDraft,
  convertQuoteToSalesOrder,
  createQuote,
  markQuoteSent,
  rejectQuote,
  updateQuote,
  type DocActor,
} from "@/lib/services/quotes";
import { listQuotesView } from "@/lib/quotes/views";
import { freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

describe.skipIf(!hasDb)("quote approvals S-18 (MySQL)", () => {
  let admin: DocActor;
  let approver: DocActor;
  let staff: DocActor;
  let viewer: DocActor;

  beforeAll(async () => {
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    approver = await db.user.create({
      data: {
        email: `approver-only-${Date.now()}@test.example.com`,
        name: "Test Approver",
        isApprover: true,
        isAdmin: false,
        isStaff: false,
        isViewer: false,
        canSeeCosts: true,
      },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("new quotes start PENDING; Staff/Viewer cannot approve", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const q = await createQuote(quoteInput(customer.id, year), staff);
    expect(q.approvalStatus).toBe("PENDING");
    await expect(approveQuote(q.id, staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveQuote(q.id, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rejectQuote(q.id, "too high", staff)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects send, email and convert while unapproved (each action)", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const q = await createQuote(quoteInput(customer.id, year), staff);
    await expect(markQuoteSent(q.id, staff)).rejects.toThrow(/waiting for approval/i);
    await expect(buildQuoteEmailDraft(q.id, staff)).rejects.toThrow(/waiting for approval/i);
    await expect(convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, staff)).rejects.toThrow(
      /waiting for approval/i,
    );
  });

  it("reject needs a reason; with reason Staff sees it; approve unlocks send/convert", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const q = await createQuote(quoteInput(customer.id, year), staff);

    await expect(rejectQuote(q.id, "   ", approver)).rejects.toBeInstanceOf(DocRuleError);
    await expect(rejectQuote(q.id, "", approver)).rejects.toThrow(/reason/i);

    const rejected = await rejectQuote(q.id, "Margin too thin", approver);
    expect(rejected.approvalStatus).toBe("REJECTED");
    expect(rejected.rejectReason).toBe("Margin too thin");
    await expect(markQuoteSent(q.id, staff)).rejects.toThrow(/rejected/i);

    // Price edit on REJECTED → PENDING (clears active reject reason; history keeps audit).
    const input = quoteInput(customer.id, year);
    input.items = input.items.map((i) => ({ ...i, unitPrice: "999.00" }));
    const reset = await updateQuote(q.id, input, staff);
    expect(reset.approvalStatus).toBe("PENDING");
    expect(reset.rejectReason).toBeNull();

    const approved = await approveQuote(q.id, approver);
    expect(approved.approvalStatus).toBe("APPROVED");
    expect(approved.approvedById).toBe(approver.id);

    const sent = await markQuoteSent(q.id, staff);
    expect(sent.status).toBe("SENT");
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, staff);
    expect(so.quoteId).toBe(q.id);
    const quoteAfter = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(quoteAfter.status).toBe("WON");
    expect(quoteAfter.approvalStatus).toBe("APPROVED");
    expect(quoteAfter.approvedById).toBe(approver.id);
  });

  it("price edit on APPROVED resets to PENDING and blocks send again", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const q = await createQuote(quoteInput(customer.id, year), staff);
    await approveQuote(q.id, admin);
    const input = quoteInput(customer.id, year);
    input.items = input.items.map((i) => ({ ...i, unitPrice: "50.00" }));
    const updated = await updateQuote(q.id, input, staff);
    expect(updated.approvalStatus).toBe("PENDING");
    expect(updated.approvedById).toBeNull();
    await expect(markQuoteSent(q.id, staff)).rejects.toThrow(/waiting for approval/i);
  });

  it("Home / list needsApproval returns PENDING quotes only", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const pending = await createQuote(quoteInput(customer.id, year), staff);
    const approved = await createQuote(quoteInput(customer.id, year), staff);
    await approveQuote(approved.id, approver);
    const list = await listQuotesView({ needsApproval: true }, approver);
    const ids = new Set(list.map((r) => r.id));
    expect(ids.has(pending.id)).toBe(true);
    expect(ids.has(approved.id)).toBe(false);
    expect(list.every((r) => r.approvalStatus === "PENDING")).toBe(true);
  });
});
