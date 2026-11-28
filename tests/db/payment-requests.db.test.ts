// Supplier payment requests (ERP adoption item 3) against MySQL 8
// (TEST_DATABASE_URL). Covers the whole lifecycle: create under the
// open-request cap, approve / reject gates, settle through the existing
// supplier-payment service, void-payment revert, void-bill cancel.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { DocRuleError } from "@/lib/documents/common";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { recordSupplierBill, voidSupplierBill } from "@/lib/services/supplier-bills";
import {
  recordSupplierPayment,
  voidSupplierPayment,
  type PayablesActor,
} from "@/lib/services/supplier-payments";
import {
  approvePaymentRequest,
  createPaymentRequest,
  rejectPaymentRequest,
} from "@/lib/services/payment-requests";
import { freshYear, makeSupplier, makeUser, paymentProof, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("supplier payment requests (MySQL)", () => {
  let admin: PayablesActor;
  let staff: PayablesActor;
  let viewer: PayablesActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-payreq-uploads-"));
    [admin, viewer] = await Promise.all([makeUser("costs"), makeUser("viewer")]);
    // The requester is ordinary staff (edit_data, no approve) WITH the
    // costs flag — assertPoAccess refuses cost-blind actors, same as
    // recording a supplier bill does.
    const t = tag();
    staff = await db.user.create({
      data: { email: `requester-${t}@test.example.com`, name: `Requester ${t}`, isStaff: true, canSeeCosts: true },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function openBill(year: number, amount: string) {
    const supplier = await makeSupplier();
    const po = await createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 1)),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", unitCost: amount }],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, admin);
    await markPurchaseOrderSent(po.id, admin);
    const bill = await recordSupplierBill(
      po.id,
      { billNumber: `INV-${tag()}`, billDate: new Date(Date.UTC(year, 2, 5)), amount, notes: null, lines: [] },
      admin,
    );
    return { supplier, po, bill };
  }

  const due = (year: number) => new Date(Date.UTC(year, 2, 20));

  it("creates a full request; a second one over the cap is refused", async () => {
    const year = await freshYear();
    const { bill } = await openBill(year, "10000.00");
    const req = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "10000.00", dueDate: due(year), note: "Pay in full" },
      staff,
    );
    expect(req.status).toBe("PENDING");
    expect(req.requestedById).toBe(staff.id);
    await expect(
      createPaymentRequest({ supplierBillId: bill.id, amount: "0.01", dueDate: due(year) }, staff),
    ).rejects.toBeInstanceOf(DocRuleError);
    // Audit rows exist for the create.
    const audits = await db.auditLog.findMany({ where: { entityType: "SupplierPaymentRequest", entityId: req.id } });
    expect(audits.some((a) => a.action === "create")).toBe(true);
  });

  it("refuses amounts above the outstanding and non-positive amounts", async () => {
    const year = await freshYear();
    const { bill } = await openBill(year, "5000.00");
    await expect(
      createPaymentRequest({ supplierBillId: bill.id, amount: "5000.01", dueDate: due(year) }, staff),
    ).rejects.toBeInstanceOf(DocRuleError);
    await expect(
      createPaymentRequest({ supplierBillId: bill.id, amount: "0.00", dueDate: due(year) }, staff),
    ).rejects.toBeInstanceOf(DocRuleError);
  });

  it("partial requests may coexist up to the outstanding, no further", async () => {
    const year = await freshYear();
    const { bill } = await openBill(year, "9000.00");
    await createPaymentRequest({ supplierBillId: bill.id, amount: "4000.00", dueDate: due(year) }, staff);
    await createPaymentRequest({ supplierBillId: bill.id, amount: "5000.00", dueDate: due(year) }, staff);
    await expect(
      createPaymentRequest({ supplierBillId: bill.id, amount: "0.01", dueDate: due(year) }, staff),
    ).rejects.toBeInstanceOf(DocRuleError);
  });

  it("gates: viewer cannot create; staff cannot approve; approver can", async () => {
    const year = await freshYear();
    const { bill } = await openBill(year, "3000.00");
    await expect(
      createPaymentRequest({ supplierBillId: bill.id, amount: "1000.00", dueDate: due(year) }, viewer),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const req = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "1000.00", dueDate: due(year) },
      staff,
    );
    await expect(approvePaymentRequest(req.id, staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approvePaymentRequest(req.id, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    const approved = await approvePaymentRequest(req.id, admin);
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedById).toBe(admin.id);
    // A decided request cannot be decided again.
    await expect(approvePaymentRequest(req.id, admin)).rejects.toBeInstanceOf(DocRuleError);
  });

  it("reject needs a reason and frees the reserved amount", async () => {
    const year = await freshYear();
    const { bill } = await openBill(year, "2000.00");
    const req = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "2000.00", dueDate: due(year) },
      staff,
    );
    await expect(rejectPaymentRequest(req.id, "  ", admin)).rejects.toBeInstanceOf(DocRuleError);
    const rejected = await rejectPaymentRequest(req.id, "Wrong account details", admin);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionNote).toBe("Wrong account details");
    // The full amount can be requested again after the rejection.
    const again = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "2000.00", dueDate: due(year) },
      staff,
    );
    expect(again.status).toBe("PENDING");
  });

  it("paying an APPROVED request through the payment service marks it PAID and drops the bill balance exactly", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "10000.00");
    const req = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "4000.00", dueDate: due(year) },
      staff,
    );
    await approvePaymentRequest(req.id, admin);
    const payment = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 12)),
        method: "BANK_TRANSFER",
        reference: "REF-TEST",
        cashAccountId: null,
        amountPaid: "4000.00",
        allocations: [{ supplierBillId: bill.id, cashApplied: "4000.00", withholdingApplied: "0.00", withholdingRate: "0.0000" }],
        paymentRequestId: req.id,
      },
      admin,
      paymentProof,
    );
    const settled = await db.supplierPaymentRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(settled.status).toBe("PAID");
    expect(settled.supplierPaymentId).toBe(payment.id);
    expect(settled.paidAt).not.toBeNull();
    const after = await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(after.status).toBe("PARTIALLY_PAID");
    const audits = await db.auditLog.findMany({ where: { entityType: "SupplierPaymentRequest", entityId: req.id } });
    expect(audits.map((a) => a.action)).toContain("update");
  });

  it("a payment that under-covers the request's bill is refused whole; a PENDING request cannot be settled", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "8000.00");
    const pending = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "3000.00", dueDate: due(year) },
      staff,
    );
    await expect(
      recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 12)),
          method: "BANK_TRANSFER",
        reference: "REF-TEST",
          cashAccountId: null,
          amountPaid: "3000.00",
          allocations: [{ supplierBillId: bill.id, cashApplied: "3000.00", withholdingApplied: "0.00", withholdingRate: "0.0000" }],
          paymentRequestId: pending.id,
        },
        admin,
        paymentProof,
      ),
    ).rejects.toBeInstanceOf(DocRuleError);

    const approved = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "5000.00", dueDate: due(year) },
      staff,
    );
    await approvePaymentRequest(approved.id, admin);
    await expect(
      recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 12)),
          method: "BANK_TRANSFER",
        reference: "REF-TEST",
          cashAccountId: null,
          amountPaid: "4999.99",
          allocations: [{ supplierBillId: bill.id, cashApplied: "4999.99", withholdingApplied: "0.00", withholdingRate: "0.0000" }],
          paymentRequestId: approved.id,
        },
        admin,
        paymentProof,
      ),
    ).rejects.toBeInstanceOf(DocRuleError);
    // Nothing was recorded by the refused attempts.
    const payments = await db.supplierPayment.count({ where: { supplierId: supplier.id } });
    expect(payments).toBe(0);
    const still = await db.supplierPaymentRequest.findUniqueOrThrow({ where: { id: approved.id } });
    expect(still.status).toBe("APPROVED");
  });

  it("voiding the settling payment returns the request to APPROVED", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "6000.00");
    const req = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "6000.00", dueDate: due(year) },
      staff,
    );
    await approvePaymentRequest(req.id, admin);
    const payment = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 12)),
        method: "BANK_TRANSFER",
        reference: "REF-TEST",
        cashAccountId: null,
        amountPaid: "6000.00",
        allocations: [{ supplierBillId: bill.id, cashApplied: "6000.00", withholdingApplied: "0.00", withholdingRate: "0.0000" }],
        paymentRequestId: req.id,
      },
      admin,
      paymentProof,
    );
    await voidSupplierPayment(payment.id, "Paid the wrong supplier", admin);
    const reverted = await db.supplierPaymentRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(reverted.status).toBe("APPROVED");
    expect(reverted.supplierPaymentId).toBeNull();
    expect(reverted.paidAt).toBeNull();
  });

  it("voiding a bill cancels its open requests in the same step", async () => {
    const year = await freshYear();
    const { bill } = await openBill(year, "7000.00");
    const pending = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "3000.00", dueDate: due(year) },
      staff,
    );
    const approved = await createPaymentRequest(
      { supplierBillId: bill.id, amount: "4000.00", dueDate: due(year) },
      staff,
    );
    await approvePaymentRequest(approved.id, admin);
    await voidSupplierBill(bill.id, "Duplicate bill", admin);
    const p = await db.supplierPaymentRequest.findUniqueOrThrow({ where: { id: pending.id } });
    const a = await db.supplierPaymentRequest.findUniqueOrThrow({ where: { id: approved.id } });
    expect(p.status).toBe("CANCELLED");
    expect(a.status).toBe("CANCELLED");
    expect(p.decisionNote).toContain("Duplicate bill");
    // No new requests on a void bill.
    await expect(
      createPaymentRequest({ supplierBillId: bill.id, amount: "1.00", dueDate: due(year) }, staff),
    ).rejects.toBeInstanceOf(DocRuleError);
  });
});
