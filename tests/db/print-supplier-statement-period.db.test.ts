// Supplier statement date filter (2026-11-07) against a real MySQL 8 database (TEST_DATABASE_URL).
// Run: TEST_DATABASE_URL=<redacted>
// With from/to the statement shows only that period's bills/payments, the
// opening balance carries what was owed before `from`, and the meta gains a
// Period row. With no dates it stays all-time, exactly as before.

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
import { formatDate } from "@/lib/format";
import { getSupplierStatementPrintModel } from "@/lib/print/views";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { recordSupplierPayment } from "@/lib/services/supplier-payments";
import { freshYear, makeSupplier, makeUser, paymentProof, tag } from "./fixtures";

describe.skipIf(!hasDb)("supplier statement period filter (MySQL)", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let approver: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-print-stmt-uploads-"));
    [admin] = await Promise.all([makeUser("costs")]);
    approver = await db.user.create({
      data: { email: `approver-stmt-${tag()}@test.example.com`, name: `Approver ${tag()}`, isApprover: true, canSeeCosts: true },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("filters to the period, carries the opening balance, and prints the Period row", async () => {
    const year = await freshYear();
    const supplier = await makeSupplier();
    const d = (month: number, day: number) => new Date(Date.UTC(year, month, day));

    async function billedPo(billDate: Date, amount: string) {
      const po = await createStandalonePurchaseOrder(
        {
          supplierId: supplier.id,
          supplierContactId: null,
          date: d(2, 1),
          expectedDate: null,
          terms: "Net 30",
          deliveryAddressText: null,
          supplierAddressText: null,
          notes: null,
          items: [{ id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", unitCost: amount }],
        },
        admin,
      );
      await approvePurchaseOrder(po.id, approver);
      await markPurchaseOrderSent(po.id, admin);
      return recordSupplierBill(
        po.id,
        { billNumber: `INV-${tag()}`, billDate, amount, notes: null, lines: [] },
        admin,
      );
    }

    async function paid(date: Date, billId: string, cash: string) {
      return recordSupplierPayment(
        {
          supplierId: supplier.id,
          date,
          method: "BANK_TRANSFER",
          reference: `REF-${tag()}`,
          checkBank: null,
          checkDate: null,
          amountPaid: cash,
          notes: null,
          allocations: [{ supplierBillId: billId, cashApplied: cash, withholdingApplied: "0", withholdingRate: "0.0000" }],
        },
        admin,
        paymentProof,
      );
    }

    // Before the period: bill 10,000 (Mar 5), payment 4,000 (Mar 10) → opening 6,000.
    const billBefore = await billedPo(d(2, 5), "10000.00");
    await paid(d(2, 10), billBefore.id, "4000.00");
    // In the period (Mar 15–31): bill 5,000 (Mar 20), payment 2,000 (Mar 25).
    const billIn = await billedPo(d(2, 20), "5000.00");
    await paid(d(2, 25), billIn.id, "2000.00");

    const from = d(2, 15);
    const to = d(2, 31);
    const filtered = (await getSupplierStatementPrintModel(supplier.id, admin, from, to))!;
    const period = filtered.doc.meta.find((m) => m.label === "Period");
    expect(period?.value).toBe(`${formatDate(d(2, 15))} – ${formatDate(d(2, 31))}`);
    // The statement model always carries a ledger (the view sets it).
    const fLedger = filtered.doc.ledger!;
    expect(fLedger.openingBalance).toBe("6000.00");
    expect(fLedger.lines).toHaveLength(2);
    expect(fLedger.lines.map((l) => l.description)).toEqual([
      expect.stringContaining("Bill"),
      expect.stringContaining("Payment"),
    ]);
    expect(fLedger.closingBalance).toBe("9000.00");

    // All-time (no dates): no Period row, opening 0, all four lines, same closing.
    const allTime = (await getSupplierStatementPrintModel(supplier.id, admin))!;
    expect(allTime.doc.meta.find((m) => m.label === "Period")).toBeUndefined();
    const aLedger = allTime.doc.ledger!;
    expect(aLedger.openingBalance).toBe("0.00");
    expect(aLedger.lines).toHaveLength(4);
    expect(aLedger.closingBalance).toBe("9000.00");
  });
});
