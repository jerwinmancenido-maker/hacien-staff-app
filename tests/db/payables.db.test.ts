// Supplier payments against MySQL 8 (TEST_DATABASE_URL).

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
import { DocRuleError, money } from "@/lib/documents/common";
import { allocateDocNumber, ensureSeries } from "@/lib/documents/series";
import { getSettingsSnapshot } from "@/lib/settings";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import {
  markSupplier2307Issued,
  recordSupplierPayment,
  voidSupplierPayment,
  type PayablesActor,
} from "@/lib/services/supplier-payments";
import { apAgingSummary } from "@/lib/payables/views";
import { addDays } from "@/lib/format";
import { freshYear, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("supplier payments / payables (MySQL)", () => {
  let admin: PayablesActor;
  let approver: PayablesActor;
  let staff: PayablesActor;
  let viewer: PayablesActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-payables-uploads-"));
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    const t = tag();
    approver = await db.user.create({
      data: { email: `approver-pay-${t}@test.example.com`, name: `Approver ${t}`, isApprover: true, canSeeCosts: true },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function openBill(year: number, amount: string, dueOffsetDays = 30) {
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
        items: [
          {
            id: null,
            description: "Goods",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            unitCost: amount,
          },
        ],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, approver);
    await markPurchaseOrderSent(po.id, admin);
    const billDate = new Date(Date.UTC(year, 2, 5));
    const bill = await recordSupplierBill(
      po.id,
      {
        billNumber: `INV-${tag()}`,
        billDate,
        amount,
        notes: null,
        lines: [],
      },
      admin,
    );
    // Ensure due date matches expected aging fixture when needed.
    if (dueOffsetDays !== 30) {
      await db.supplierBill.update({
        where: { id: bill.id },
        data: { dueDate: addDays(billDate, dueOffsetDays) },
      });
    }
    return { supplier, po, bill, year, billDate };
  }

  it("Admin and Approver can record; Staff and Viewer cannot", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "10000.00");
    const base = {
      supplierId: supplier.id,
      date: new Date(Date.UTC(year, 2, 10)),
      method: "BANK_TRANSFER" as const,
      reference: "REF-PERM",
      checkBank: null as string | null,
      checkDate: null as Date | null,
      amountPaid: "10000.00",
      notes: null as string | null,
      allocations: [
        {
          supplierBillId: bill.id,
          cashApplied: "10000.00",
          withholdingApplied: "0",
          withholdingRate: "0.0000",
          atcCode: null as string | null,
        },
      ],
    };
    await expect(recordSupplierPayment(base, staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordSupplierPayment(base, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    // Fresh bill for successful creates (first attempt would have failed before write).
    const a = await openBill(year, "5000.00");
    const pay = await recordSupplierPayment(
      {
        ...base,
        supplierId: a.supplier.id,
        amountPaid: "5000.00",
        allocations: [
          {
            supplierBillId: a.bill.id,
            cashApplied: "5000.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect(pay.number).toMatch(/^PAY-\d{4}-\d+$/);
    const b = await openBill(year, "3000.00");
    const pay2 = await recordSupplierPayment(
      {
        ...base,
        supplierId: b.supplier.id,
        amountPaid: "3000.00",
        reference: "REF-APP",
        allocations: [
          {
            supplierBillId: b.bill.id,
            cashApplied: "3000.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      approver,
    );
    expect(pay2.createdById).toBe(approver.id);
  });

  it("partial and full payment update bill status; over- and under-allocation blocked", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "10000.00");

    const partial = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        amountPaid: "4000.00",
        notes: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "4000.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PARTIALLY_PAID");

    await expect(
      recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 11)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          amountPaid: "5000.00",
          notes: null,
          allocations: [
            {
              supplierBillId: bill.id,
              cashApplied: "7000.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(DocRuleError);

    await expect(
      recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 11)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          amountPaid: "5000.00",
          notes: null,
          allocations: [
            {
              supplierBillId: bill.id,
              cashApplied: "3000.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/still left to allocate/i);

    await expect(
      recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 11)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          amountPaid: "7000.00",
          notes: null,
          allocations: [
            {
              supplierBillId: bill.id,
              cashApplied: "7000.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/only has ₱|Lower the cash/i);

    const full = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 12)),
        method: "BANK_TRANSFER",
        reference: "REF-FULL",
        checkBank: null,
        checkDate: null,
        amountPaid: "6000.00",
        notes: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "6000.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
    expect(partial.id).toBeTruthy();
    expect(full.id).toBeTruthy();
  });

  it("withholding math snapshots rate/ATC on allocation; creates 2307 to issue", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "100000.00");
    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "BANK_TRANSFER",
        reference: "EWT-1",
        checkBank: null,
        checkDate: null,
        amountPaid: "99000.00",
        notes: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "99000.00",
            withholdingApplied: "1000.00",
            withholdingRate: "0.0100",
            atcCode: "WC010",
          },
        ],
      },
      admin,
    );
    const alloc = await db.supplierPaymentAllocation.findFirstOrThrow({ where: { supplierPaymentId: pay.id } });
    expect(money(alloc.cashApplied)).toBe("99000.00");
    expect(money(alloc.withholdingApplied)).toBe("1000.00");
    expect(Number(alloc.withholdingRate).toFixed(4)).toBe("0.0100");
    expect(alloc.atcCode).toBe("WC010");
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");

    const wh = await db.supplierWithholding2307.findFirstOrThrow({ where: { supplierPaymentId: pay.id } });
    expect(wh.status).toBe("TO_ISSUE");
    expect(money(wh.amount)).toBe("1000.00");

    await markSupplier2307Issued(wh.id, { issuedAt: new Date(Date.UTC(year, 2, 20)), notes: null }, admin, []);
    expect((await db.supplierWithholding2307.findUniqueOrThrow({ where: { id: wh.id } })).status).toBe("ISSUED");
    await expect(voidSupplierPayment(pay.id, "too late", admin)).rejects.toThrow(/issued 2307/i);
  });

  it("void recomputes bill status, writes audit + DocumentVoid, and never reuses the number", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "8000.00");
    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "E_WALLET",
        reference: "GC-1",
        checkBank: null,
        checkDate: null,
        amountPaid: "8000.00",
        notes: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "8000.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");

    await expect(voidSupplierPayment(pay.id, "  ", admin)).rejects.toThrow(/reason/i);
    await expect(voidSupplierPayment(pay.id, "Wrong amount", staff)).rejects.toBeInstanceOf(ForbiddenError);

    await voidSupplierPayment(pay.id, "Wrong amount", admin);
    expect((await db.supplierPayment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("VOID");
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("RECORDED");
    expect(await db.documentVoid.count({ where: { docType: "SUPPLIER_PAYMENT", docId: pay.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "SupplierPayment", entityId: pay.id, action: "void" } })).toBe(1);

    // Number not reused: next payment gets the next counter.
    const snap = await getSettingsSnapshot();
    const format = snap.settings.numbering.supplierPayment;
    await ensureSeries(db, "SUPPLIER_PAYMENT", year, format);
    const next = await db.$transaction(async (tx) => allocateDocNumber(tx, "SUPPLIER_PAYMENT", year, format));
    expect(next).not.toBe(pay.number);
    const nPay = Number(pay.number.split("-").pop());
    const nNext = Number(next.split("-").pop());
    expect(nNext).toBeGreaterThan(nPay);
  });

  it("one payment to many bills; AP aging buckets by due date", async () => {
    const year = await freshYear();
    const supplier = await makeSupplier();
    const today = new Date(Date.UTC(year, 5, 15));
    const mk = async (amount: string, dueDaysAgo: number) => {
      const po = await createStandalonePurchaseOrder(
        {
          supplierId: supplier.id,
          supplierContactId: null,
          date: new Date(Date.UTC(year, 2, 1)),
          expectedDate: null,
          terms: "COD",
          deliveryAddressText: null,
          supplierAddressText: null,
          notes: null,
          items: [{ id: null, description: "Item", kind: "GOODS", qty: "1", unit: "lot", unitCost: amount }],
        },
        admin,
      );
      await approvePurchaseOrder(po.id, approver);
      await markPurchaseOrderSent(po.id, admin);
      const bill = await recordSupplierBill(
        po.id,
        { billNumber: `INV-${tag()}`, billDate: addDays(today, -dueDaysAgo), amount, notes: null, lines: [] },
        admin,
      );
      await db.supplierBill.update({
        where: { id: bill.id },
        data: { dueDate: addDays(today, -dueDaysAgo) },
      });
      return bill;
    };
    const bCurrent = await mk("100.00", -5); // due in 5 days
    const b30 = await mk("200.00", 10);
    const b60 = await mk("300.00", 40);
    void bCurrent;

    await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: today,
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        amountPaid: "150.00",
        notes: null,
        allocations: [
          {
            supplierBillId: b30.id,
            cashApplied: "100.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
          {
            supplierBillId: b60.id,
            cashApplied: "50.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: b30.id } })).status).toBe("PARTIALLY_PAID");
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: b60.id } })).status).toBe("PARTIALLY_PAID");

    const aging = await apAgingSummary(today);
    const row = aging.bySupplier.find((r) => r.supplierId === supplier.id);
    expect(row).toBeTruthy();
    expect(row!.aging.current).toBe("100.00");
    expect(row!.aging.d1_30).toBe("100.00"); // 200-100
    expect(row!.aging.d31_60).toBe("250.00"); // 300-50
  });

  it("blocks allocation to void or already-paid bills", async () => {
    const year = await freshYear();
    const voided = await openBill(year, "2000.00");
    await db.supplierBill.update({
      where: { id: voided.bill.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: "Duplicate" },
    });
    await expect(
      recordSupplierPayment(
        {
          supplierId: voided.supplier.id,
          date: new Date(Date.UTC(year, 2, 10)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          amountPaid: "2000.00",
          notes: null,
          allocations: [
            {
              supplierBillId: voided.bill.id,
              cashApplied: "2000.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/void/i);

    const paid = await openBill(year, "1500.00");
    await recordSupplierPayment(
      {
        supplierId: paid.supplier.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        amountPaid: "1500.00",
        notes: null,
        allocations: [
          {
            supplierBillId: paid.bill.id,
            cashApplied: "1500.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: paid.bill.id } })).status).toBe("PAID");
    await expect(
      recordSupplierPayment(
        {
          supplierId: paid.supplier.id,
          date: new Date(Date.UTC(year, 2, 11)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          amountPaid: "100.00",
          notes: null,
          allocations: [
            {
              supplierBillId: paid.bill.id,
              cashApplied: "100.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/already fully paid/i);
  });

  it("concurrent double-allocation is blocked (row lock)", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "10000.00");
    const mk = (ref: string) =>
      recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 10)),
          method: "BANK_TRANSFER",
          reference: ref,
          checkBank: null,
          checkDate: null,
          amountPaid: "10000.00",
          notes: null,
          allocations: [
            {
              supplierBillId: bill.id,
              cashApplied: "10000.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        admin,
      );
    const results = await Promise.allSettled([mk("CONC-A"), mk("CONC-B")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    for (const r of bad) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(DocRuleError);
    }
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
    expect(await db.supplierPayment.count({ where: { supplierId: supplier.id, status: "POSTED" } })).toBe(1);
  });

  it("void reverses bill balances, clears 2307 to-issue, and restores AP aging", async () => {
    const year = await freshYear();
    const today = new Date(Date.UTC(year, 5, 15));
    const { supplier, bill } = await openBill(year, "10000.00", -10); // overdue 10 days from billDate+offset
    // Force due date relative to `today` for aging.
    await db.supplierBill.update({
      where: { id: bill.id },
      data: { dueDate: addDays(today, -10) },
    });

    const beforeAging = await apAgingSummary(today);
    const beforeRow = beforeAging.bySupplier.find((r) => r.supplierId === supplier.id);
    expect(beforeRow?.aging.d1_30).toBe("10000.00");

    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: today,
        method: "BANK_TRANSFER",
        reference: "EWT-VOID",
        checkBank: null,
        checkDate: null,
        amountPaid: "9900.00",
        notes: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "9900.00",
            withholdingApplied: "100.00",
            withholdingRate: "0.0100",
            atcCode: "WC010",
          },
        ],
      },
      admin,
    );
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
    const wh = await db.supplierWithholding2307.findFirstOrThrow({ where: { supplierPaymentId: pay.id } });
    expect(wh.status).toBe("TO_ISSUE");
    expect(money(wh.amount)).toBe("100.00");
    expect((await apAgingSummary(today)).bySupplier.find((r) => r.supplierId === supplier.id)).toBeUndefined();

    await voidSupplierPayment(pay.id, "Wrong withholding", admin);
    expect((await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("RECORDED");
    expect(money((await db.supplierWithholding2307.findUniqueOrThrow({ where: { id: wh.id } })).amount)).toBe("0.00");
    // Zeroed 2307 must not appear on to-issue list / pending total.
    expect(await db.supplierWithholding2307.count({ where: { status: "TO_ISSUE", amount: { gt: 0 }, id: wh.id } })).toBe(0);
    const afterAging = await apAgingSummary(today);
    expect(afterAging.bySupplier.find((r) => r.supplierId === supplier.id)?.aging.d1_30).toBe("10000.00");
  });

  it("ForbiddenError message is clear for Staff (no crash)", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "500.00");
    try {
      await recordSupplierPayment(
        {
          supplierId: supplier.id,
          date: new Date(Date.UTC(year, 2, 10)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          amountPaid: "500.00",
          notes: null,
          allocations: [
            {
              supplierBillId: bill.id,
              cashApplied: "500.00",
              withholdingApplied: "0",
              withholdingRate: "0.0000",
              atcCode: null,
            },
          ],
        },
        staff,
      );
      expect.unreachable("staff should be forbidden");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as Error).message).toMatch(/permission/i);
    }
  });

  it("audit entry on create", async () => {
    const year = await freshYear();
    const { supplier, bill } = await openBill(year, "1000.00");
    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "CHECK",
        reference: "CHK-9",
        checkBank: "UB",
        checkDate: new Date(Date.UTC(year, 2, 9)),
        amountPaid: "1000.00",
        notes: null,
        allocations: [
          {
            supplierBillId: bill.id,
            cashApplied: "1000.00",
            withholdingApplied: "0",
            withholdingRate: "0.0000",
            atcCode: null,
          },
        ],
      },
      admin,
    );
    expect(await db.auditLog.count({ where: { entityType: "SupplierPayment", entityId: pay.id, action: "create" } })).toBe(1);
  });
});
