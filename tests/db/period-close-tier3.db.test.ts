// Phase 4 #10 step 3: Tier 3 period guards — deliveries, receiving,
// supplier returns, customer returns (record + void halves, 8 points)
// against MySQL 8 (TEST_DATABASE_URL).
//
// Same pattern as the Tier 1 suite: each test closes a distinct month,
// the path succeeds while the month is open, closePeriod (real service,
// Admin actor) closes it, the same call then rejects with the
// closed-period message ("is closed"), and an open-month control still
// works. PeriodLock rows are REOPENED in afterAll / pre-cleaned in
// beforeAll — the app's no-delete extension forbids deleteMany.

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
import { getSettingsSnapshot } from "@/lib/settings";
import { postCustomerReturn, voidCustomerReturn } from "@/lib/services/customer-returns";
import { recordDelivery, voidDelivery } from "@/lib/services/deliveries";
import { closePeriod, reopenPeriod } from "@/lib/services/period-close";
import {
  approvePurchaseOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { postReceivingReport, voidReceivingReport } from "@/lib/services/receiving";
import { postSupplierReturn, voidSupplierReturn } from "@/lib/services/returns";
import { customerDeliveryAddressId, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/** Every month this file closes — cleaned up so reruns start open. */
const CLOSED_MONTHS = ["2023-03", "2023-05", "2023-07", "2023-09", "2023-11", "2024-01", "2024-03", "2024-05"];

describe.skipIf(!env.hasDb)("period close Tier 3 guards (MySQL)", () => {
  let admin: DocActor;
  let approver: DocActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-period-close3-uploads-"));
    admin = await makeUser("costs");
    const t = tag();
    approver = await db.user.create({
      data: { email: `approver-pc3-${t}@test.example.com`, name: `Approver PC3 ${t}`, isApprover: true, canSeeCosts: true },
    });
    await ensureWideDrBooklet();
    await reopenAll();
  });

  /** Reopen every month this file closed (no hard deletes in this app). */
  async function reopenAll() {
    for (const ym of CLOSED_MONTHS) {
      try {
        await reopenPeriod(ym, "Test cleanup — reopen after period-close suite", admin);
      } catch {
        // Not closed (test failed before closing, or a rerun pre-clean) — fine.
      }
    }
  }

  afterAll(async () => {
    await reopenAll();
    await db.$disconnect();
  });

  let drSeq = 980_000 + Math.floor(Math.random() * 15_000);
  const nextDr = () => String(++drSeq);

  async function ensureWideDrBooklet() {
    const typeWide = {
      atpNo: "",
      atpDate: "",
      printer: "",
      seriesFrom: 1,
      seriesTo: 9_999_999,
      bookletCount: 10,
      setsPerBooklet: 50,
      isNonVat: true,
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      const ib = snap.settings.invoiceBooklet;
      if ((ib.deliveryReceipt?.seriesTo ?? 0) >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1,
            data: { ...(latest.data as object), invoiceBooklet: { ...ib, deliveryReceipt: { ...typeWide } } } as never,
            changedKey: "invoiceBooklet",
            before: ib,
            after: { deliveryReceipt: typeWide },
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // Unique version race with another suite — retry.
      }
    }
  }

  /** An SO with one GOODS line of qty 10 (supplier-less, price 500). */
  async function makeSo(soDate: Date) {
    const customer = await makeCustomer();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: soDate,
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Widget A", kind: "GOODS", qty: "10", unit: "pc", supplierId: null, supplierUnitCost: "0", unitPrice: "500" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-PC3-${tag()}`, deliveryAddressId }, admin, { date: soDate });
    const withItems = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    return { customer, so, itemId: withItems.items[0]!.id };
  }

  const deliveryInput = (itemId: string, deliveryDate: Date, qty = "1.00") => ({
    drNumber: nextDr(),
    deliveryDate,
    idSightChecked: false,
    items: [{ salesOrderItemId: itemId, qty }],
  });

  /** A standalone PO taken to SENT, one GOODS line of qty 10. */
  async function makeSentPo(poDate: Date) {
    const supplier = await makeSupplier();
    const po = await createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: poDate,
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "10", unit: "lot", unitCost: "100.00" }],
      },
      admin,
    );
    await approvePurchaseOrder(po.id, approver);
    await markPurchaseOrderSent(po.id, admin);
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, orderBy: { sortOrder: "asc" } });
    return { supplier, po, lineId: lines[0]!.id };
  }

  const receiptInput = (lineId: string, receivedDate: Date, qty = "2") => ({
    receivedDate,
    receivedById: admin.id,
    deliveryRef: "DR-PC3",
    notes: null,
    lines: [{ lineId, qty }],
  });

  const supplierReturnInput = (lineId: string, returnDate: Date, qty = "1") => ({
    returnDate,
    reason: "Defective",
    creditNoteNumber: null,
    creditNoteAmount: null,
    lines: [{ lineId, qty }],
  });

  // 19 — recordDelivery: deliveryDate
  it("recordDelivery refuses a closed delivery month; an open month still posts", async () => {
    const { so, itemId } = await makeSo(d(2023, 2, 2));
    const first = await recordDelivery(so.id, deliveryInput(itemId, d(2023, 3, 10)), admin);
    expect(first.id).toBeTruthy();
    await closePeriod("2023-03", admin);
    const before = await db.delivery.count({ where: { salesOrderId: so.id } });
    await expect(recordDelivery(so.id, deliveryInput(itemId, d(2023, 3, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.delivery.count({ where: { salesOrderId: so.id } })).toBe(before);
    const other = await recordDelivery(so.id, deliveryInput(itemId, d(2023, 4, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 20 — voidDelivery: the delivery's deliveryDate
  it("voidDelivery refuses a delivery dated in a closed month", async () => {
    const { so, itemId } = await makeSo(d(2023, 4, 2));
    const del = await recordDelivery(so.id, deliveryInput(itemId, d(2023, 5, 10)), admin);
    await closePeriod("2023-05", admin);
    await expect(voidDelivery(del.id, "Entered wrong quantity", admin)).rejects.toThrow(/is closed/);
    expect((await db.delivery.findUniqueOrThrow({ where: { id: del.id } })).voidedAt).toBeNull();
    const other = await recordDelivery(so.id, deliveryInput(itemId, d(2023, 6, 10)), admin);
    const voided = await voidDelivery(other.id, "Entered wrong quantity", admin);
    expect(voided.voidedAt).toBeInstanceOf(Date);
  });

  // 21 — postReceivingReport: receivedDate
  it("postReceivingReport refuses a closed received month; an open month still posts", async () => {
    const { po, lineId } = await makeSentPo(d(2023, 6, 2));
    const first = await postReceivingReport(po.id, receiptInput(lineId, d(2023, 7, 10)), admin);
    expect(first.id).toBeTruthy();
    await closePeriod("2023-07", admin);
    const before = await db.receivingReport.count({ where: { purchaseOrderId: po.id } });
    await expect(postReceivingReport(po.id, receiptInput(lineId, d(2023, 7, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.receivingReport.count({ where: { purchaseOrderId: po.id } })).toBe(before);
    const other = await postReceivingReport(po.id, receiptInput(lineId, d(2023, 8, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 22 — voidReceivingReport: the report's receivedDate
  it("voidReceivingReport refuses a report dated in a closed month", async () => {
    const { po, lineId } = await makeSentPo(d(2023, 8, 2));
    const rr = await postReceivingReport(po.id, receiptInput(lineId, d(2023, 9, 10)), admin);
    await closePeriod("2023-09", admin);
    await expect(voidReceivingReport(rr.id, "Counted twice", admin)).rejects.toThrow(/is closed/);
    expect((await db.receivingReport.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe("POSTED");
    const other = await postReceivingReport(po.id, receiptInput(lineId, d(2023, 10, 10)), admin);
    const voided = await voidReceivingReport(other.id, "Counted twice", admin);
    expect(voided.status).toBe("VOID");
  });

  // 23 — postSupplierReturn: returnDate
  it("postSupplierReturn refuses a closed return month; an open month still posts", async () => {
    const { po, lineId } = await makeSentPo(d(2023, 10, 2));
    await postReceivingReport(po.id, receiptInput(lineId, d(2023, 11, 5), "10"), admin);
    const first = await postSupplierReturn(po.id, supplierReturnInput(lineId, d(2023, 11, 10)), admin);
    expect(first.id).toBeTruthy();
    await closePeriod("2023-11", admin);
    const before = await db.supplierReturn.count({ where: { purchaseOrderId: po.id } });
    await expect(postSupplierReturn(po.id, supplierReturnInput(lineId, d(2023, 11, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.supplierReturn.count({ where: { purchaseOrderId: po.id } })).toBe(before);
    const other = await postSupplierReturn(po.id, supplierReturnInput(lineId, d(2023, 12, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 24 — voidSupplierReturn: the return's returnDate
  it("voidSupplierReturn refuses a return dated in a closed month", async () => {
    const { po, lineId } = await makeSentPo(d(2023, 12, 2));
    await postReceivingReport(po.id, receiptInput(lineId, d(2024, 1, 5), "5"), admin);
    const ret = await postSupplierReturn(po.id, supplierReturnInput(lineId, d(2024, 1, 10)), admin);
    await closePeriod("2024-01", admin);
    await expect(voidSupplierReturn(ret.id, "Wrong return — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.supplierReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe("POSTED");
    const other = await postSupplierReturn(po.id, supplierReturnInput(lineId, d(2024, 2, 10)), admin);
    await voidSupplierReturn(other.id, "Wrong return — reverse", admin);
    expect((await db.supplierReturn.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("VOID");
  });

  // 25 — postCustomerReturn: returnDate
  it("postCustomerReturn refuses a closed return month; an open month still posts", async () => {
    const { so, itemId } = await makeSo(d(2024, 2, 2));
    await recordDelivery(so.id, deliveryInput(itemId, d(2024, 2, 10), "2.00"), admin);
    const retInput = (returnDate: Date) => ({ returnDate, reason: "Defective", lines: [{ lineId: itemId, qty: "1" }] });
    const first = await postCustomerReturn(so.id, retInput(d(2024, 3, 10)), admin);
    expect(first.id).toBeTruthy();
    await closePeriod("2024-03", admin);
    const before = await db.customerReturn.count({ where: { salesOrderId: so.id } });
    await expect(postCustomerReturn(so.id, retInput(d(2024, 3, 15)), admin)).rejects.toThrow(/is closed/);
    expect(await db.customerReturn.count({ where: { salesOrderId: so.id } })).toBe(before);
    const other = await postCustomerReturn(so.id, retInput(d(2024, 4, 10)), admin);
    expect(other.id).toBeTruthy();
  });

  // 26 — voidCustomerReturn: the return's returnDate
  it("voidCustomerReturn refuses a return dated in a closed month", async () => {
    const { so, itemId } = await makeSo(d(2024, 4, 2));
    await recordDelivery(so.id, deliveryInput(itemId, d(2024, 5, 5), "2.00"), admin);
    const retInput = (returnDate: Date) => ({ returnDate, reason: "Defective", lines: [{ lineId: itemId, qty: "1" }] });
    const ret = await postCustomerReturn(so.id, retInput(d(2024, 5, 10)), admin);
    await closePeriod("2024-05", admin);
    await expect(voidCustomerReturn(ret.id, "Wrong item returned", admin)).rejects.toThrow(/is closed/);
    expect((await db.customerReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe("POSTED");
    const other = await postCustomerReturn(so.id, retInput(d(2024, 6, 10)), admin);
    await voidCustomerReturn(other.id, "Wrong item returned", admin);
    expect((await db.customerReturn.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("VOID");
  });
});
