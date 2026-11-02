// S-20 void limits, record_billing flag, price lock, and change-password.
// Throwaway test database only (TEST_DATABASE_URL).

import { describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { checkLoginRateLimit } from "@/lib/auth/rate-limit";
import { ForbiddenError } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { listNeedsAdminCheck } from "@/lib/billing/views";
import { markBillingChecked, recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import { createStandalonePurchaseOrder, markPurchaseOrderSent, voidPurchaseOrder } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, voidQuote, type DocActor } from "@/lib/services/quotes";
import { postReceivingReport, voidReceivingReport } from "@/lib/services/receiving";
import { updateSalesOrder, voidSalesOrder } from "@/lib/services/sales-orders";
import { changePassword } from "@/lib/services/users";
import type { PoInput } from "@/lib/validation/purchasing";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

describe.skipIf(!hasDb)("S-20 void, billing rights, price lock, password (MySQL)", () => {
  async function actors() {
    const [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    const t = tag();
    const approver = await db.user.create({
      data: { email: `approver-${t}@test.example.com`, name: `Approver ${t}`, isApprover: true, canSeeCosts: true },
    });
    return { admin, staff, viewer, approver };
  }

  async function wonSo(admin: DocActor) {
    const year = await freshYear();
    const customer = await makeCustomer();
    const quote = await createQuote(quoteInput(customer.id, year, { withholdingCodes: ["GOODS_1"] }), admin);
    await approveQuote(quote.id, admin);
    const so = await convertQuoteToSalesOrder(quote.id, { buyerPoNo: null, deliveryAddress: null }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    return { year, customer, quote, so };
  }

  it("refuses Staff and Viewer voids on all six record types and requires a reason", async () => {
    const { admin, staff, viewer, approver } = await actors();
    const { year, customer, quote, so } = await wonSo(admin);

    for (const actor of [staff, viewer]) {
      await expect(voidQuote(quote.id, "Customer cancelled", actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(voidSalesOrder(so.id, "Buyer cancelled", actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(voidQuote(quote.id, "  ", admin)).rejects.toThrow(/reason/);
    await expect(voidQuote(quote.id, "no", admin)).rejects.toThrow(/at least 3 characters/i);
    await expect(voidSalesOrder(so.id, "  ", approver)).rejects.toThrow(/reason/);
    await expect(voidSalesOrder(so.id, "no", approver)).rejects.toThrow(/at least 3 characters/i);

    const supplier = await makeSupplier();
    const poInput: PoInput = {
      supplierId: supplier.id,
      supplierContactId: null,
      date: new Date(Date.UTC(year, 5, 1)),
      expectedDate: null,
      terms: null,
      deliveryAddressText: null,
      supplierAddressText: null,
      notes: null,
      items: [{ id: null, description: "Paper", kind: "GOODS", qty: "1", unit: "lot", unitCost: "100" }],
    };
    const po = await createStandalonePurchaseOrder(poInput, admin);
    for (const actor of [staff, viewer]) {
      await expect(voidPurchaseOrder(po.id, "Wrong supplier", actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(voidPurchaseOrder(po.id, " ", admin)).rejects.toThrow(/reason/);
    await expect(voidPurchaseOrder(po.id, "no", admin)).rejects.toThrow(/at least 3 characters/i);
    await markPurchaseOrderSent(po.id, admin);
    const line = await db.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    const rr = await postReceivingReport(
      po.id,
      {
        receivedDate: new Date(Date.UTC(year, 5, 2)),
        receivedById: staff.id,
        deliveryRef: null,
        notes: null,
        lines: [{ lineId: line.id, qty: "1" }],
      },
      staff,
    );
    for (const actor of [staff, viewer]) {
      await expect(voidReceivingReport(rr.id, "Counted twice", actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(voidReceivingReport(rr.id, " ", admin)).rejects.toThrow(/reason/);
    await expect(voidReceivingReport(rr.id, "no", admin)).rejects.toThrow(/at least 3 characters/i);

    const { settings } = await getSettingsSnapshot();
    const { seriesFrom, seriesTo } = settings.invoiceBooklet;
    const maxInvoice = await db.billing.aggregate({
      _max: { invoiceNo: true },
      where: { invoiceNo: { gte: seriesFrom, lte: seriesTo } },
    });
    const invoiceNo = Math.max(seriesFrom, (maxInvoice._max.invoiceNo ?? seriesFrom - 1) + 1);
    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "100.00",
          invoiceNo,
          invoiceDate: new Date(Date.UTC(year, 2, 5)),
          dueDate: new Date(Date.UTC(year, 3, 4)),
          notes: null,
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "100.00",
        invoiceNo,
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      staff,
    );
    expect(billing.needsAdminCheck).toBe(true);
    for (const actor of [staff, viewer]) {
      await expect(voidBilling(billing.id, "Wrong booklet", actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(voidBilling(billing.id, " ", admin)).rejects.toThrow(/reason/);
    await expect(voidBilling(billing.id, "no", approver)).rejects.toThrow(/at least 3 characters/i);

    const collection = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-${tag()}`,
        amountReceived: "99.00",
        notes: null,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "99.00",
            withholdingApplied: "1.00",
            withholdingRate: "0.0100",
            atcCode: "WI158",
          },
        ],
      },
      staff,
    );
    expect(collection.needsAdminCheck).toBe(true);
    expect(await db.withholding2307.count({ where: { collectionId: collection.id } })).toBeGreaterThan(0);
    for (const actor of [staff, viewer]) {
      await expect(voidCollection(collection.id, "Reverse", actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(voidCollection(collection.id, " ", admin)).rejects.toThrow(/reason/);
    await expect(voidCollection(collection.id, "no", approver)).rejects.toThrow(/at least 3 characters/i);

    await expect(markBillingChecked(billing.id, approver)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await markBillingChecked(billing.id, admin)).needsAdminCheck).toBe(false);
    expect((await voidCollection(collection.id, "Reverse the sample payment", approver)).status).toBe("VOID");
    const queue = await listNeedsAdminCheck();
    expect(queue.collections.some((row) => row.id === collection.id)).toBe(false);
    expect((await db.collection.findUniqueOrThrow({ where: { id: collection.id } })).needsAdminCheck).toBe(false);

    expect((await voidBilling(billing.id, "Approver voided billing", approver)).status).toBe("VOID");

    await expect(createStandalonePurchaseOrder(poInput, staff)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await voidReceivingReport(rr.id, "Counted twice", admin)).status).toBe("VOID");
    expect((await voidSalesOrder(so.id, "Buyer cancelled", approver)).status).toBe("VOID");
    expect((await voidQuote(quote.id, "Customer cancelled", approver)).status).toBe("VOID");
  });

  it("locks a won sales order price for Staff and logs an Admin reason", async () => {
    const { admin, staff } = await actors();
    const { so } = await wonSo(admin);
    const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    const items = rows.map((i) => ({
      id: i.id,
      description: i.description,
      kind: i.kind,
      qty: Number(i.qty).toFixed(2),
      unit: i.unit,
      unitPrice: Number(i.unitPrice).toFixed(2),
      supplierId: i.supplierId,
      supplierUnitCost: Number(i.supplierUnitCost).toFixed(2),
      withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
      withholdingAtc: i.withholdingAtc,
      withholdingOverride: i.withholdingOverride,
    }));
    const base = { contactId: so.contactId, buyerPoNo: so.buyerPoNo, deliveryAddress: so.deliveryAddress, terms: so.terms, notes: "Desk note", items };
    const saved = await updateSalesOrder(so.id, base, staff);
    expect(saved.notes).toBe("Desk note");
    const priced = { ...base, notes: so.notes, items: items.map((i, n) => (n === 0 ? { ...i, unitPrice: "1.00" } : i)) };
    await expect(updateSalesOrder(so.id, priced, staff)).rejects.toThrow(/locked/);
    await expect(updateSalesOrder(so.id, priced, admin)).rejects.toThrow(/reason/);
    await updateSalesOrder(so.id, { ...priced, priceOverrideReason: "Correct the peso" }, admin);
    const audit = await db.auditLog.findFirst({ where: { entityType: "SalesOrder", entityId: so.id, action: "update" }, orderBy: { at: "desc" } });
    expect(JSON.stringify(audit?.after)).toContain("Correct the peso");
  });

  it("won sales order rejects Staff reapplyWithholding with a new code and allows Admin with reason", async () => {
    const { admin, staff } = await actors();
    const { so } = await wonSo(admin);
    const firstRow = await db.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    const originalAtc = firstRow.withholdingAtc;
    const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    const items = rows.map((i) => ({
      id: i.id,
      description: i.description,
      kind: i.kind,
      qty: Number(i.qty).toFixed(2),
      unit: i.unit,
      unitPrice: Number(i.unitPrice).toFixed(2),
      supplierId: i.supplierId,
      supplierUnitCost: Number(i.supplierUnitCost).toFixed(2),
      withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
      withholdingAtc: i.withholdingAtc,
      withholdingOverride: false,
    }));
    const base = { contactId: so.contactId, buyerPoNo: so.buyerPoNo, deliveryAddress: so.deliveryAddress, terms: so.terms, notes: so.notes, items };

    // Staff tries to POST reapplyWithholding: true with a different ATC (e.g. SERVICES_2 / WI640)
    const reapplyPayload = {
      ...base,
      reapplyWithholding: true,
      withholdingCodes: ["SERVICES_2"],
    };

    // Staff is rejected
    await expect(updateSalesOrder(so.id, reapplyPayload, staff)).rejects.toThrow(/locked/);

    // Verify nothing changed in DB
    const unchanged = await db.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: so.id, removedAt: null } });
    expect(unchanged.withholdingAtc).toBe(originalAtc);

    // Admin without reason is rejected
    await expect(updateSalesOrder(so.id, reapplyPayload, admin)).rejects.toThrow(/reason/);

    // Admin with reason succeeds
    const updated = await updateSalesOrder(
      so.id,
      { ...reapplyPayload, priceOverrideReason: "Admin updated ATC" },
      admin,
    );
    const updatedItem = updated.items.find((i) => i.id === unchanged.id);
    expect(updatedItem?.withholdingAtc).not.toBe(originalAtc);
  });

  it("change password needs the current password, retires the old one, and revokes other sessions", async () => {
    const staff = await makeUser("staff");
    const current = "OldSample123!";
    const next = "NewSample123!";
    await db.user.update({ where: { id: staff.id }, data: { passwordHash: await hashPassword(current) } });

    const keptTokenHash = `kept-hash-${tag()}`;
    const otherTokenHash = `other-hash-${tag()}`;
    await db.session.createMany({
      data: [
        { userId: staff.id, tokenHash: keptTokenHash, expiresAt: new Date(Date.now() + 100_000) },
        { userId: staff.id, tokenHash: otherTokenHash, expiresAt: new Date(Date.now() + 100_000) },
      ],
    });

    await expect(changePassword(staff.id, "WrongSample123!", next, null)).rejects.toThrow(/current password/i);
    await changePassword(staff.id, current, next, keptTokenHash);
    const row = await db.user.findUniqueOrThrow({ where: { id: staff.id } });
    expect(await verifyPassword(current, row.passwordHash)).toBe(false);
    expect(await verifyPassword(next, row.passwordHash)).toBe(true);

    const keptSession = await db.session.findUniqueOrThrow({ where: { tokenHash: keptTokenHash } });
    expect(keptSession.revokedAt).toBeNull();
    const otherSession = await db.session.findUniqueOrThrow({ where: { tokenHash: otherTokenHash } });
    expect(otherSession.revokedAt).not.toBeNull();
  });

  it("denies repeated wrong current passwords under the rate limiter", async () => {
    const staff = await makeUser("staff");
    const staffRow = await db.user.findUniqueOrThrow({ where: { id: staff.id } });
    const ip = "192.168.1.100";
    const rateKey = `pwd:${staffRow.email}`;
    for (let i = 0; i < 5; i++) {
      await db.loginAttempt.create({ data: { email: rateKey, ip, success: false } });
    }
    expect(await checkLoginRateLimit(db, rateKey, ip)).toBe(true);
  });
});
