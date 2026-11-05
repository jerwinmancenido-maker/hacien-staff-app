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
  confirmNoneAndMarkQuoteSent,
  convertQuoteToSalesOrder,
  createQuote,
  markQuoteSent,
  rejectQuote,
  updateQuote,
  type DocActor,
} from "@/lib/services/quotes";
import { getQuoteView, listQuotesView } from "@/lib/quotes/views";
import { COST_NOT_SET_LABEL, supplierCostMissing } from "@/lib/quotes/calc";
import { money } from "@/lib/documents/common";
import type { QuoteInput } from "@/lib/validation/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

function inputFromQuote(
  q: {
    customerId: string;
    contactId: string | null;
    date: Date;
    validUntil: Date | null;
    terms: string | null;
    notes: string | null;
    internalNotes: string | null;
    subject: string | null;
    buyerPoNo: string | null;
    items: Array<{
      id: string;
      description: string;
      kind: "GOODS" | "SERVICES";
      qty: { toFixed(n: number): string } | string | number;
      unit: string;
      supplierId: string | null;
      supplierUnitCost: { toFixed(n: number): string } | string | number;
      unitPrice: { toFixed(n: number): string } | string | number;
      withholdingRate: { toFixed(n: number): string } | string | number | null;
      withholdingAtc: string | null;
      withholdingOverride: boolean;
    }>;
  },
  extra: Partial<QuoteInput> = {},
): QuoteInput {
  return {
    customerId: q.customerId,
    contactId: q.contactId,
    date: q.date,
    validUntil: q.validUntil ?? undefined,
    terms: q.terms,
    notes: q.notes,
    internalNotes: q.internalNotes,
    subject: q.subject,
    buyerPoNo: q.buyerPoNo,
    items: q.items.map((i) => ({
      id: i.id,
      description: i.description,
      kind: i.kind,
      qty: money(i.qty),
      unit: i.unit,
      supplierId: i.supplierId,
      supplierUnitCost: money(i.supplierUnitCost),
      unitPrice: money(i.unitPrice),
      withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
      withholdingAtc: i.withholdingAtc,
      withholdingOverride: i.withholdingOverride,
    })),
    ...extra,
  };
}

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
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddressId }, staff);
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

  it("Home / list needsApproval returns PENDING open quotes only (excludes WON)", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const pending = await createQuote(quoteInput(customer.id, year), staff);
    const approved = await createQuote(quoteInput(customer.id, year), staff);
    await approveQuote(approved.id, approver);
    const won = await createQuote(quoteInput(customer.id, year), staff);
    await approveQuote(won.id, approver);
    await markQuoteSent(won.id, staff);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    await convertQuoteToSalesOrder(won.id, { buyerPoNo: "PO-1", deliveryAddressId }, staff);
    const wonRow = await db.quote.findUniqueOrThrow({ where: { id: won.id } });
    expect(wonRow.status).toBe("WON");
    // WON stays APPROVED; even if forced PENDING it must stay out of the waiting list.
    await db.quote.update({ where: { id: won.id }, data: { approvalStatus: "PENDING" } });
    try {
      const list = await listQuotesView({ needsApproval: true }, approver);
      const ids = new Set(list.map((r) => r.id));
      expect(ids.has(pending.id)).toBe(true);
      expect(ids.has(approved.id)).toBe(false);
      expect(ids.has(won.id)).toBe(false);
      expect(list.every((r) => r.approvalStatus === "PENDING")).toBe(true);
    } finally {
      await db.quote.update({
        where: { id: won.id },
        data: { approvalStatus: "APPROVED", approvedById: null, approvedAt: null },
      });
    }
  });

  it("notes-only edit keeps APPROVED; confirmNoneAndMarkQuoteSent rejects PENDING", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const q = await createQuote(quoteInput(customer.id, year), staff);
    await approveQuote(q.id, approver);
    const notesOnly = await updateQuote(q.id, inputFromQuote(q, { notes: "Sample note only" }), staff);
    expect(notesOnly.approvalStatus).toBe("APPROVED");
    expect(notesOnly.approvedById).toBe(approver.id);

    const pending = await createQuote(quoteInput(customer.id, year), staff);
    await expect(confirmNoneAndMarkQuoteSent(pending.id, staff)).rejects.toThrow(/waiting for approval/i);
  });

  it("supplier-cost-only or withholding-only edit resets APPROVED to PENDING", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    // Cost user so supplierUnitCost / withholding overrides are accepted on save.
    const q = await createQuote(quoteInput(customer.id, year), admin);
    await approveQuote(q.id, approver);

    const costEdit = inputFromQuote(q);
    costEdit.items = costEdit.items.map((i, idx) =>
      idx === 0 ? { ...i, supplierUnitCost: "46000.00" } : i,
    );
    const afterCost = await updateQuote(q.id, costEdit, admin);
    expect(afterCost.approvalStatus).toBe("PENDING");
    expect(afterCost.approvedById).toBeNull();

    await approveQuote(q.id, approver);
    const reloaded = await db.quote.findUniqueOrThrow({
      where: { id: q.id },
      include: { items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    const whEdit = inputFromQuote(reloaded);
    whEdit.items = whEdit.items.map((i, idx) =>
      idx === 0 ? { ...i, withholdingRate: "0.0100", withholdingAtc: "WI010", withholdingOverride: true } : i,
    );
    const afterWh = await updateQuote(q.id, whEdit, admin);
    expect(afterWh.approvalStatus).toBe("PENDING");
    expect(afterWh.approvedById).toBeNull();
  });

  it("supplier-cost-only edit on REJECTED resets to PENDING", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const q = await createQuote(quoteInput(customer.id, year), admin);
    await rejectQuote(q.id, "Margin too thin", approver);
    const rejected = await db.quote.findUniqueOrThrow({
      where: { id: q.id },
      include: { items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    expect(rejected.approvalStatus).toBe("REJECTED");
    const costEdit = inputFromQuote(rejected);
    costEdit.items = costEdit.items.map((i, idx) =>
      idx === 0 ? { ...i, supplierUnitCost: "47000.00" } : i,
    );
    const after = await updateQuote(q.id, costEdit, admin);
    expect(after.approvalStatus).toBe("PENDING");
    expect(after.rejectReason).toBeNull();
    expect(after.rejectedById).toBeNull();
  });

  it("reordering lines by id keeps APPROVED", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const q = await createQuote(quoteInput(customer.id, year), staff);
    await approveQuote(q.id, approver);
    const reversed = inputFromQuote(q);
    reversed.items = [...reversed.items].reverse();
    const after = await updateQuote(q.id, reversed, staff);
    expect(after.approvalStatus).toBe("APPROVED");
    expect(after.approvedById).toBe(approver.id);
  });

  it("mixed lines need approval and label Cost not set only on the blank and zero lines", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();
    const input = quoteInput(customer.id, year);
    input.items = [
      { id: null, description: "Costed", kind: "GOODS", qty: "2", unit: "pc", supplierId: null, supplierUnitCost: "600", unitPrice: "1000" },
      { id: null, description: "Blank", kind: "GOODS", qty: "1", unit: "pc", supplierId: null, supplierUnitCost: "", unitPrice: "500" },
      { id: null, description: "Zero", kind: "SERVICES", qty: "1", unit: "lot", supplierId: null, supplierUnitCost: "0.00", unitPrice: "200" },
    ];
    const q = await createQuote(input, admin);
    expect(q.approvalStatus).toBe("PENDING");
    const view = await getQuoteView(q.id, admin);
    expect(view?.approval.needed).toBe(true);
    expect(view?.approval.reasons).toEqual([COST_NOT_SET_LABEL]);
    expect(view?.totals.supplierCostState).toBe("partial");
    const costed = view?.items.find((i) => i.description === "Costed");
    const blank = view?.items.find((i) => i.description === "Blank");
    const zero = view?.items.find((i) => i.description === "Zero");
    expect(supplierCostMissing(costed?.supplierUnitCost)).toBe(false);
    expect(costed?.margin).toBe("800.00");
    expect(supplierCostMissing(blank?.supplierUnitCost)).toBe(true);
    expect(supplierCostMissing(zero?.supplierUnitCost)).toBe(true);
    await expect(markQuoteSent(q.id, staff)).rejects.toThrow(/waiting for approval/i);
    await expect(convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, staff)).rejects.toThrow(
      /waiting for approval/i,
    );
  });

  it("clearing an approved quote's supplier cost to 0.00 or blank needs approval again before send or convert", async () => {
    const customer = await makeCustomer();
    const year = await freshYear();

    async function approvedQuote() {
      const q = await createQuote(quoteInput(customer.id, year), admin);
      await approveQuote(q.id, approver);
      return q.id;
    }

    async function clearCosts(id: string, value: string) {
      const row = await db.quote.findUniqueOrThrow({
        where: { id },
        include: { items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
      });
      const edit = inputFromQuote(row);
      edit.items = edit.items.map((i) => ({ ...i, supplierUnitCost: value }));
      return updateQuote(id, edit, admin);
    }

    const zeroId = await approvedQuote();
    const zeroed = await clearCosts(zeroId, "0.00");
    expect(zeroed.approvalStatus).toBe("PENDING");
    expect(zeroed.approvedById).toBeNull();
    await expect(markQuoteSent(zeroId, staff)).rejects.toThrow(/waiting for approval/i);
    await expect(convertQuoteToSalesOrder(zeroId, { buyerPoNo: null, deliveryAddress: null }, staff)).rejects.toThrow(
      /waiting for approval/i,
    );
    await expect(confirmNoneAndMarkQuoteSent(zeroId, staff)).rejects.toThrow(/waiting for approval/i);

    const blankId = await approvedQuote();
    const blanked = await clearCosts(blankId, "");
    expect(blanked.approvalStatus).toBe("PENDING");
    expect(blanked.approvedById).toBeNull();
    expect(blanked.items.every((i) => money(i.supplierUnitCost) === "0.00")).toBe(true);
    await expect(markQuoteSent(blankId, staff)).rejects.toThrow(/waiting for approval/i);
    await expect(convertQuoteToSalesOrder(blankId, { buyerPoNo: null, deliveryAddress: null }, staff)).rejects.toThrow(
      /waiting for approval/i,
    );
    // S-101: same confirm-none reject check the zero-cost case above already has.
    await expect(confirmNoneAndMarkQuoteSent(blankId, staff)).rejects.toThrow(/waiting for approval/i);
  });
});
