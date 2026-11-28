// ERP adoption item 7: order-list progress percentages. Runs on MySQL 8
// (TEST_DATABASE_URL). Rows are created directly — the list views only read —
// with amounts chosen so every percentage is checkable by hand:
//   SO/PO partial: delivered/received 4 of 10 = 40%, billed 400 of 1000 = 40%,
//   paid (250 cash + 50 withholding) of 400 billed = 75%.
// VOID documents and VOID payments must not move any number; VOID orders
// carry no progress; a measure with no true base is null (no fake 0 bar).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { listSalesOrdersPageView } from "@/lib/quotes/views";
import { listPurchaseOrdersView } from "@/lib/purchasing/views";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";
import type { DocActor } from "@/lib/services/quotes";

const DAY = new Date(Date.UTC(2026, 0, 15));

describe.skipIf(!env.hasDb)("order list progress (MySQL)", () => {
  let admin: DocActor;
  let viewer: DocActor;
  let settingsVersionId: string;
  const run = tag();
  const soPartial = `SO-PROG-${run}-A`;
  const soVoid = `SO-PROG-${run}-V`;
  const soZero = `SO-PROG-${run}-Z`;
  const soCredit = `SO-PROG-${run}-C`;
  const poPartial = `PO-PROG-${run}-A`;
  const poVoid = `PO-PROG-${run}-V`;
  const poZero = `PO-PROG-${run}-Z`;
  let invoiceSeq = 0;

  beforeAll(async () => {
    admin = await makeUser("costs");
    viewer = await makeUser("viewer");
    settingsVersionId = (await getSettingsSnapshot()).versionId;
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    await freshYear();
    invoiceSeq = 910_000 + Math.floor(Math.random() * 50_000);

    const mkSo = async (number: string, status: "OPEN" | "VOID", contractPrice: string) =>
      db.salesOrder.create({
        data: {
          number,
          customerId: customer.id,
          date: DAY,
          status,
          settingsVersionId,
          withholding: [],
          contractPrice,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
    const mkLines = async (salesOrderId: string, lines: { qty: string; deliveredQty: string }[]) => {
      for (const [i, l] of lines.entries()) {
        await db.salesOrderItem.create({
          data: {
            salesOrderId,
            sortOrder: i,
            description: `Line ${i + 1}`,
            kind: "GOODS",
            qty: l.qty,
            unit: "pc",
            unitPrice: "100.00",
            total: "100.00",
            deliveredQty: l.deliveredQty,
          },
        });
      }
    };
    const mkBilling = async (salesOrderId: string, number: string, status: "OPEN" | "VOID", amount: string, dueDate: Date = DAY) =>
      db.billing.create({
        data: {
          number,
          salesOrderId,
          customerId: customer.id,
          invoiceNo: ++invoiceSeq,
          invoiceDate: DAY,
          dueDate,
          amount,
          netExpected: amount,
          status,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });

    // SO partial: 4/10 delivered, 400/1000 billed, 300/400 paid.
    const soA = await mkSo(soPartial, "OPEN", "1000.00");
    await mkLines(soA.id, [
      { qty: "4.00", deliveredQty: "1.00" },
      { qty: "6.00", deliveredQty: "3.00" },
    ]);
    const blA = await mkBilling(soA.id, `BL-PROG-${run}-A`, "OPEN", "400.00");
    await mkBilling(soA.id, `BL-PROG-${run}-AV`, "VOID", "999.00");
    const colA = await db.collection.create({
      data: { number: `CR-PROG-${run}-A`, customerId: customer.id, date: DAY, method: "CASH", amountReceived: "300.00", status: "POSTED", createdById: admin.id },
    });
    await db.collectionAllocation.create({
      data: { collectionId: colA.id, billingId: blA.id, cashApplied: "250.00", withholdingApplied: "50.00" },
    });
    // A VOID collection's allocation must not count toward Paid.
    const colVoid = await db.collection.create({
      data: { number: `CR-PROG-${run}-AV`, customerId: customer.id, date: DAY, method: "CASH", amountReceived: "100.00", status: "VOID", createdById: admin.id },
    });
    await db.collectionAllocation.create({
      data: { collectionId: colVoid.id, billingId: blA.id, cashApplied: "100.00", withholdingApplied: "0.00" },
    });

    // SO void: progress must be null even with lines + billings present.
    const soV = await mkSo(soVoid, "VOID", "1000.00");
    await mkLines(soV.id, [{ qty: "2.00", deliveredQty: "2.00" }]);
    await mkBilling(soV.id, `BL-PROG-${run}-V`, "OPEN", "1000.00");

    // SO zero: ₱0 contract, no lines, no billings — every measure baseless.
    await mkSo(soZero, "OPEN", "0.00");

    // SO credit: paid entirely by a POSTED return-credit application.
    const soC = await mkSo(soCredit, "OPEN", "500.00");
    // Due far in the future on purpose: this billing is the shared test DB's
    // only credit-paid billing, and the home-dashboard suite's overdue
    // recount reads collection allocations only — an overdue credit-paid
    // billing left behind here would skew its global sums. Progress does
    // not depend on due dates, so the assertions are unaffected.
    const blC = await mkBilling(soC.id, `BL-PROG-${run}-C`, "OPEN", "500.00", new Date(Date.UTC(2027, 0, 15)));
    const ret = await db.customerReturn.create({
      data: { number: `RT-PROG-${run}-C`, salesOrderId: soC.id, returnDate: DAY, status: "POSTED", createdById: admin.id },
    });
    const credit = await db.customerCredit.create({
      data: { customerId: customer.id, customerReturnId: ret.id, amount: "125.00", createdById: admin.id },
    });
    await db.customerCreditApplication.create({
      data: { customerCreditId: credit.id, billingId: blC.id, cashApplied: "125.00" },
    });

    const mkPo = async (number: string, status: "DRAFT" | "SENT" | "VOID", subtotal: string) =>
      db.purchaseOrder.create({
        data: {
          number,
          supplierId: supplier.id,
          date: DAY,
          status,
          settingsVersionId,
          subtotal,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
    const mkPoLines = async (purchaseOrderId: string, lines: { qty: string; receivedQty: string }[]) => {
      for (const [i, l] of lines.entries()) {
        await db.purchaseOrderItem.create({
          data: {
            purchaseOrderId,
            sortOrder: i,
            description: `PO line ${i + 1}`,
            kind: "GOODS",
            qty: l.qty,
            unit: "pc",
            unitCost: "100.00",
            total: "100.00",
            receivedQty: l.receivedQty,
          },
        });
      }
    };

    // PO partial: 4/10 received, 400/1000 billed, 300/400 paid.
    const poA = await mkPo(poPartial, "SENT", "1000.00");
    await mkPoLines(poA.id, [
      { qty: "4.00", receivedQty: "1.00" },
      { qty: "6.00", receivedQty: "3.00" },
    ]);
    const billA = await db.supplierBill.create({
      data: {
        supplierId: supplier.id,
        purchaseOrderId: poA.id,
        billNumber: `SB-PROG-${run}-A`,
        billDate: DAY,
        dueDate: DAY,
        amount: "400.00",
        status: "RECORDED",
        createdById: admin.id,
      },
    });
    await db.supplierBill.create({
      data: {
        supplierId: supplier.id,
        purchaseOrderId: poA.id,
        billNumber: `SB-PROG-${run}-AV`,
        billDate: DAY,
        dueDate: DAY,
        amount: "999.00",
        status: "VOID",
        createdById: admin.id,
      },
    });
    const payA = await db.supplierPayment.create({
      data: {
        number: `PAY-PROG-${run}-A`,
        supplierId: supplier.id,
        date: DAY,
        method: "CASH",
        amountPaid: "300.00",
        status: "POSTED",
        createdById: admin.id,
      },
    });
    await db.supplierPaymentAllocation.create({
      data: { supplierPaymentId: payA.id, supplierBillId: billA.id, cashApplied: "250.00", withholdingApplied: "50.00" },
    });
    const payVoid = await db.supplierPayment.create({
      data: {
        number: `PAY-PROG-${run}-AV`,
        supplierId: supplier.id,
        date: DAY,
        method: "CASH",
        amountPaid: "100.00",
        status: "VOID",
        createdById: admin.id,
      },
    });
    await db.supplierPaymentAllocation.create({
      data: { supplierPaymentId: payVoid.id, supplierBillId: billA.id, cashApplied: "100.00", withholdingApplied: "0.00" },
    });

    // PO void / PO zero.
    const poV = await mkPo(poVoid, "VOID", "1000.00");
    await mkPoLines(poV.id, [{ qty: "2.00", receivedQty: "2.00" }]);
    const poZ = await mkPo(poZero, "DRAFT", "0.00");
    await mkPoLines(poZ.id, [{ qty: "3.00", receivedQty: "0.00" }]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("SO list: delivered / billed / paid from the document aggregates", async () => {
    const page = await listSalesOrdersPageView({ q: `SO-PROG-${run}` }, 1, 50);
    const byNumber = new Map(page.items.map((r) => [r.number, r]));
    expect(byNumber.get(soPartial)?.progress).toEqual({ deliveredPct: 40, billedPct: 40, paidPct: 75 });
    expect(byNumber.get(soVoid)?.progress).toBeNull();
    expect(byNumber.get(soZero)?.progress).toEqual({ deliveredPct: null, billedPct: null, paidPct: null });
    // Return-credit counts as paid: 125 of 500 billed = 25%.
    expect(byNumber.get(soCredit)?.progress).toEqual({ deliveredPct: null, billedPct: 100, paidPct: 25 });
  });

  it("PO list: received for everyone, billed / paid for cost viewers only", async () => {
    const costRows = await listPurchaseOrdersView({ q: `PO-PROG-${run}` }, admin);
    const byNumber = new Map(costRows.map((r) => [r.number, r]));
    expect(byNumber.get(poPartial)?.progress).toEqual({ receivedPct: 40, billedPct: 40, paidPct: 75 });
    expect(byNumber.get(poVoid)?.progress).toBeNull();
    expect(byNumber.get(poZero)?.progress).toEqual({ receivedPct: 0, billedPct: null, paidPct: null });

    const viewerRows = await listPurchaseOrdersView({ q: `PO-PROG-${run}` }, viewer);
    const vByNumber = new Map(viewerRows.map((r) => [r.number, r]));
    expect(vByNumber.get(poPartial)?.progress).toEqual({ receivedPct: 40, billedPct: null, paidPct: null });
  });
});
