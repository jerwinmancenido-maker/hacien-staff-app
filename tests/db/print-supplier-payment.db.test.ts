// Supplier payment print meta (2026-11-07) against a real MySQL 8 database (TEST_DATABASE_URL).
// Run: TEST_DATABASE_URL=mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien_test npm test -- tests/db/print-supplier-payment.db.test.ts
// The Method row must show the human label ("Bank transfer"), never the raw
// stored code ("BANK_TRANSFER").

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
import { getSupplierPaymentPrintModel } from "@/lib/print/views";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { recordSupplierPayment } from "@/lib/services/supplier-payments";
import { freshYear, makeSupplier, makeUser, paymentProof, tag } from "./fixtures";

describe.skipIf(!hasDb)("supplier payment print (MySQL)", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let approver: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-print-payment-uploads-"));
    [admin] = await Promise.all([makeUser("costs")]);
    approver = await db.user.create({
      data: { email: `approver-print-${tag()}@test.example.com`, name: `Approver ${tag()}`, isApprover: true, canSeeCosts: true },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("prints the payment method as a label, not the stored code", async () => {
    const year = await freshYear();
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
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", unitCost: "10000.00" }],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, approver);
    await markPurchaseOrderSent(po.id, admin);
    const bill = await recordSupplierBill(
      po.id,
      { billNumber: `INV-${tag()}`, billDate: new Date(Date.UTC(year, 2, 5)), amount: "10000.00", notes: null, lines: [] },
      admin,
    );
    const payment = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "BANK_TRANSFER",
        reference: "REF-PRINT",
        checkBank: null,
        checkDate: null,
        amountPaid: "10000.00",
        notes: null,
        allocations: [{ supplierBillId: bill.id, cashApplied: "10000.00", withholdingApplied: "0", withholdingRate: "0.0000" }],
      },
      admin,
      paymentProof,
    );
    const { doc } = (await getSupplierPaymentPrintModel(payment.id, admin))!;
    const method = doc.meta.find((m) => m.label === "Method");
    expect(method?.value).toBe("Bank transfer");
    expect(JSON.stringify(doc.meta)).not.toContain("BANK_TRANSFER");
  });
});
