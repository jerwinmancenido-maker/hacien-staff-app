// Supplier POs, receiving reports, bills and the 3-way match against MySQL 8
// (TEST_DATABASE_URL). Uploads go to a temporary UPLOAD_DIR.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { DocRuleError } from "@/lib/documents/common";
import { formatDocNumber } from "@/lib/documents/series";
import { convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import {
  approvePurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrdersFromSalesOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
  updatePurchaseOrder,
  voidPurchaseOrder,
} from "@/lib/services/purchase-orders";
import { postReceivingReport, ReceiptError, voidReceivingReport } from "@/lib/services/receiving";
import { recordSupplierBill, voidSupplierBill } from "@/lib/services/supplier-bills";
import { attachmentDownload } from "@/lib/attachments-download";
import {
  getPurchaseOrderEditData,
  getPurchaseOrderPrint,
  getPurchaseOrderView,
  getReceivingView,
  getSoPurchasing,
  listPurchaseOrdersView,
  listReceivingView,
} from "@/lib/purchasing/views";
import { listTransactions } from "@/lib/services/transactions";
import type { PoInput } from "@/lib/validation/purchasing";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

/** Keys that must never reach a user without "Can see costs" on the receiving pages. */
const PRICE_KEYS = ["unitCost", "total", "amount", "subtotal", "supplierId", "supplierUnitCost", "unitPrice", "billedAmount"];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

describe.skipIf(!env.hasDb)("supplier POs, receiving and bills (MySQL)", () => {
  let admin: DocActor; // Admin + Approver + costs
  let approver: DocActor; // Approver + costs, not admin
  let buyer: DocActor; // Staff + costs, not approver
  let staff: DocActor; // Staff, no costs
  let viewer: DocActor;
  let poFormat: { prefix: string; padding: number };
  let rrFormat: { prefix: string; padding: number };

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-po-uploads-"));
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    const t = tag();
    approver = await db.user.create({ data: { email: `approver-${t}@test.example.com`, name: `Approver ${t}`, isApprover: true, canSeeCosts: true } });
    buyer = await db.user.create({ data: { email: `buyer-${t}@test.example.com`, name: `Buyer ${t}`, isStaff: true, canSeeCosts: true } });
    const { settings } = await getSettingsSnapshot();
    poFormat = settings.numbering.supplierPo;
    rrFormat = settings.numbering.receivingReport;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** An open SO (quote Won) with lines from supplier A (2), supplier B (1) and one with no supplier. */
  async function salesOrder(year: number) {
    const customer = await makeCustomer();
    const [a, b] = await Promise.all([makeSupplier(), makeSupplier()]);
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Laptop i5", kind: "GOODS", qty: "10", unit: "pc", supplierId: a.id, supplierUnitCost: "45000", unitPrice: "52000" },
          { id: null, description: "Mouse", kind: "GOODS", qty: "10", unit: "pc", supplierId: a.id, supplierUnitCost: "500", unitPrice: "800" },
          { id: null, description: "Printer", kind: "GOODS", qty: "2", unit: "unit", supplierId: b.id, supplierUnitCost: "12000.50", unitPrice: "15000" },
          { id: null, description: "Installation", kind: "SERVICES", qty: "1", unit: "lot", supplierId: null, supplierUnitCost: "0", unitPrice: "20000" },
        ],
      },
      admin,
    );
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-1", deliveryAddress: "TESDA, Taguig" }, admin, { date: new Date(Date.UTC(year, 2, 2)) });
    const items = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id }, orderBy: { sortOrder: "asc" } });
    return { customer, a, b, so, items };
  }

  const fromSo = (year: number, extra: Record<string, unknown> = {}) => ({ date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {}, ...extra });

  /** A PO taken to SENT. */
  async function sentPo(year: number) {
    const ctx = await salesOrder(year);
    const [poA] = await createPurchaseOrdersFromSalesOrder(ctx.so.id, fromSo(year), buyer);
    await approvePurchaseOrder(poA!.id, approver);
    await markPurchaseOrderSent(poA!.id, buyer);
    const items = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: poA!.id }, orderBy: { sortOrder: "asc" } });
    return { ...ctx, po: poA!, lines: items };
  }

  const receipt = (year: number, lines: { lineId: string; qty: string }[], by: string) => ({
    receivedDate: new Date(Date.UTC(year, 3, 1)),
    receivedById: by,
    deliveryRef: "DR-77",
    notes: null,
    lines,
  });

  // -------------------------------------------------------------------------
  describe("create POs from a sales order", () => {
    it("creates one Draft PO per supplier in one transaction, with costs copied from the SO lines", async () => {
      const year = await freshYear();
      const { so, a, b, items } = await salesOrder(year);
      const pos = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer);
      expect(pos.map((p) => p.number)).toEqual([formatDocNumber(poFormat, year, 1), formatDocNumber(poFormat, year, 2)]);
      expect(pos.map((p) => p.supplierId)).toEqual([a.id, b.id]);
      expect(pos.every((p) => p.status === "DRAFT" && p.salesOrderId === so.id)).toBe(true);
      const poA = pos[0]!;
      expect(poA.items.map((i) => [i.description, i.qty.toFixed(2), i.unitCost.toFixed(2), i.total.toFixed(2)])).toEqual([
        ["Laptop i5", "10.00", "45000.00", "450000.00"],
        ["Mouse", "10.00", "500.00", "5000.00"],
      ]);
      expect(poA.subtotal.toFixed(2)).toBe("455000.00");
      expect(pos[1]!.items[0]!.unitCost.toFixed(2)).toBe("12000.50");
      expect(poA.items.map((i) => i.activeSalesOrderItemId)).toEqual([items[0]!.id, items[1]!.id]);
      expect(poA.deliveryAddressText).toBe("TESDA, Taguig");
      // Audit rows written in the same transaction.
      const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseOrder", entityId: { in: pos.map((p) => p.id) }, action: "create" } });
      expect(audits).toHaveLength(2);
      expect(await db.auditLog.count({ where: { entityType: "SalesOrder", entityId: so.id, action: "update", userId: buyer.id } })).toBe(1);
    });

    it("skips lines already on a PO and lines with no supplier, unless one is picked", async () => {
      const year = await freshYear();
      const { so, b, items } = await salesOrder(year);
      await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer);
      await expect(createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer)).rejects.toThrow(/Pick a supplier/);
      const [third] = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year, { supplierPicks: { [items[3]!.id]: b.id } }), buyer);
      expect(third!.number).toBe(formatDocNumber(poFormat, year, 3));
      expect(third!.items.map((i) => i.description)).toEqual(["Installation"]);
      await expect(createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer)).rejects.toThrow(/already on a PO/);
      const progress = await getSoPurchasing(so.id, admin);
      expect(progress.ordered).toBe(4);
      expect(progress.lines.every((l) => l.state === "ORDERED")).toBe(true);
    });

    it("two people creating POs from the same SO at once: one set of POs only", async () => {
      const year = await freshYear();
      const { so } = await salesOrder(year);
      const results = await Promise.allSettled([createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer), createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), admin)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(2);
    });

    it("needs edit_data AND cost access", async () => {
      const year = await freshYear();
      const { so } = await salesOrder(year);
      await expect(createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), staff)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), viewer)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("status flow and roles", () => {
    it("Draft → Approved → Sent; approver ≠ creator unless admin; staff can't approve", async () => {
      const year = await freshYear();
      const { so } = await salesOrder(year);
      const [po, po2] = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), approver);
      // The creator (an approver, not admin) can't approve their own PO.
      await expect(approvePurchaseOrder(po!.id, approver)).rejects.toThrow(/other than the creator/);
      await expect(approvePurchaseOrder(po!.id, buyer)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(markPurchaseOrderSent(po!.id, buyer)).rejects.toThrow(/Approve the PO/);
      // Admins have "approve" and may approve their own.
      const own = await createStandalonePurchaseOrder(standalone(po!.supplierId, year), admin);
      expect((await approvePurchaseOrder(own.id, admin)).status).toBe("APPROVED");
      const approved = await approvePurchaseOrder(po!.id, admin);
      expect(approved.approvedById).toBe(admin.id);
      expect((await markPurchaseOrderSent(po!.id, buyer)).status).toBe("SENT");
      await expect(approvePurchaseOrder(po!.id, admin)).rejects.toThrow(/Only a draft/);
      await expect(closePurchaseOrder(po!.id, null, buyer)).rejects.toThrow(/partially or fully received/);
      expect((await voidPurchaseOrder(po2!.id, "Changed supplier", buyer)).status).toBe("VOID");
      await expect(markPurchaseOrderSent(po2!.id, buyer)).rejects.toThrow(/void/);
      const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseOrder", entityId: po!.id }, orderBy: { at: "asc" } });
      expect(audits.map((a) => (a.after as { status?: string }).status ?? null)).toEqual(expect.arrayContaining(["DRAFT", "APPROVED", "SENT"]));
      expect(await db.documentVoid.count({ where: { docType: "PURCHASE_ORDER", docId: po2!.id } })).toBe(1);
    });

    it("editing an approved PO returns it to Draft, clears approval and bumps the revision", async () => {
      const year = await freshYear();
      const { so } = await salesOrder(year);
      const [po] = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer);
      await approvePurchaseOrder(po!.id, approver);
      const edit = (await getPurchaseOrderEditData(po!.id, buyer))!;
      const input: PoInput = {
        supplierId: edit.supplierId,
        supplierContactId: null,
        date: new Date(`${edit.date}T00:00:00.000Z`),
        expectedDate: null,
        terms: "COD",
        deliveryAddressText: edit.deliveryAddressText,
        supplierAddressText: null,
        notes: null,
        items: edit.items.slice(0, 1).map((i) => ({ id: i.id, description: i.description, kind: i.kind, qty: "8", unit: i.unit, unitCost: "44000" })),
      };
      const after = await updatePurchaseOrder(po!.id, input, buyer);
      expect(after.status).toBe("DRAFT");
      expect(after.revision).toBe(2);
      expect(after.approvedById).toBeNull();
      expect(after.subtotal.toFixed(2)).toBe("352000.00");
      // The removed line frees its SO line.
      expect(await db.purchaseOrderItem.count({ where: { purchaseOrderId: po!.id, removedAt: { not: null }, activeSalesOrderItemId: null } })).toBe(1);
      const view = (await getPurchaseOrderView(po!.id, { ...admin, isAdmin: true }))!;
      expect(view.items[0]!.qtyWarning).toMatch(/less than the SO qty/);
      const audit = await db.auditLog.findFirst({ where: { entityType: "PurchaseOrder", entityId: po!.id, action: "update" }, orderBy: { at: "desc" } });
      expect(JSON.stringify(audit!.after)).toMatch(/cleared/);
    });
  });

  // -------------------------------------------------------------------------
  describe("receiving", () => {
    it("staff without costs receive partially, then fully; over-receiving is rejected", async () => {
      const year = await freshYear();
      const { po, lines, so } = await sentPo(year);
      const [laptop, mouse] = lines;
      const rr1 = await postReceivingReport(po.id, receipt(year, [{ lineId: laptop!.id, qty: "4" }, { lineId: mouse!.id, qty: "0" }], staff.id), staff);
      expect(rr1.number).toBe(formatDocNumber(rrFormat, year, 1));
      expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");

      const over = postReceivingReport(po.id, receipt(year, [{ lineId: laptop!.id, qty: "7" }], staff.id), staff);
      await expect(over).rejects.toBeInstanceOf(ReceiptError);
      await expect(over).rejects.toThrow(/more than was ordered/);

      await postReceivingReport(po.id, receipt(year, [{ lineId: laptop!.id, qty: "6" }, { lineId: mouse!.id, qty: "10" }], staff.id), staff);
      expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
      await expect(postReceivingReport(po.id, receipt(year, [{ lineId: mouse!.id, qty: "1" }], staff.id), staff)).rejects.toThrow(/sent or partially received/);
      await expect(postReceivingReport(po.id, receipt(year, [{ lineId: mouse!.id, qty: "1" }], staff.id), viewer)).rejects.toBeInstanceOf(ForbiddenError);

      const progress = await getSoPurchasing(so.id, staff);
      expect(progress.received).toBe(2);
      // Non-cost users see the PO number but get no PO id (PO pages are cost-gated).
      expect(progress.lines[0]!.purchaseOrders[0]).toEqual({ number: po.number, status: "RECEIVED" });
      expect((await getSoPurchasing(so.id, admin)).lines[0]!.purchaseOrders[0]!.id).toBe(po.id);
    });

    it("two receipts posted at the same time for the last units: exactly one succeeds", async () => {
      const year = await freshYear();
      const { po, lines } = await sentPo(year);
      const laptop = lines[0]!;
      const results = await Promise.allSettled(
        Array.from({ length: 2 }, () => postReceivingReport(po.id, receipt(year, [{ lineId: laptop.id, qty: "10" }], staff.id), staff)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ReceiptError);
      expect((await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: laptop.id } })).receivedQty.toFixed(2)).toBe("10.00");
      expect(await db.receivingReport.count({ where: { purchaseOrderId: po.id, status: "POSTED" } })).toBe(1);
    });

    it("five parallel receipts of 3 on a line of 10: three succeed, never over-received", async () => {
      const year = await freshYear();
      const { po, lines } = await sentPo(year);
      const laptop = lines[0]!;
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => postReceivingReport(po.id, receipt(year, [{ lineId: laptop.id, qty: "3" }], staff.id), staff)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect((await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: laptop.id } })).receivedQty.toFixed(2)).toBe("9.00");
      const numbers = (await db.receivingReport.findMany({ where: { purchaseOrderId: po.id }, select: { number: true } })).map((r) => r.number).sort();
      expect(numbers).toEqual([1, 2, 3].map((n) => formatDocNumber(rrFormat, year, n)));
    });

    it("voiding an RR reverses quantities and status; a PO with posted RRs can't be voided; voiding the PO frees its SO lines", async () => {
      const year = await freshYear();
      const { po, lines, so } = await sentPo(year);
      const rr = await postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "10" }, { lineId: lines[1]!.id, qty: "10" }], staff.id), staff);
      expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
      await expect(voidPurchaseOrder(po.id, "Wrong supplier", buyer)).rejects.toThrow(/Only a draft, approved or sent/);

      await voidReceivingReport(rr.id, "Counted twice", staff);
      const after = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
      expect(after.status).toBe("SENT");
      expect(after.items.map((i) => i.receivedQty.toFixed(2))).toEqual(["0.00", "0.00"]);
      expect(await db.documentVoid.count({ where: { docType: "RECEIVING_REPORT", docId: rr.id } })).toBe(1);
      await expect(voidReceivingReport(rr.id, "again", staff)).rejects.toThrow(/already void/);

      await voidPurchaseOrder(po.id, "Wrong supplier", buyer);
      expect(await db.purchaseOrderItem.count({ where: { purchaseOrderId: po.id, activeSalesOrderItemId: { not: null } } })).toBe(0);
      const again = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer);
      expect(again.flatMap((p) => p.items.map((i) => i.description))).toEqual(["Laptop i5", "Mouse"]);
    });

    it("a PO with a posted RR can't be voided while SENT-with-receipts; short-close needs a reason", async () => {
      const year = await freshYear();
      const { po, lines } = await sentPo(year);
      await postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "5" }], staff.id), staff);
      await expect(closePurchaseOrder(po.id, null, buyer)).rejects.toThrow(/reason/);
      const closed = await closePurchaseOrder(po.id, "Supplier out of stock", buyer);
      expect(closed.status).toBe("CLOSED");
      expect(closed.closeReason).toBe("Supplier out of stock");
      const rr = await db.receivingReport.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
      await expect(voidReceivingReport(rr.id, "x x x", staff)).rejects.toThrow(/closed/);
    });

    it("receiving payloads carry no prices for staff; PO pages are cost-gated", async () => {
      const year = await freshYear();
      const { po, lines } = await sentPo(year);
      const rr = await postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "2" }], staff.id), staff, [{ name: "dr.png", size: PNG.length, bytes: PNG }]);
      for (const u of [staff, viewer, admin]) {
        const view = await getReceivingView(po.id, u);
        const list = await listReceivingView({}, u);
        const keys = keysDeep([view, list.filter((r) => r.id === po.id)]);
        for (const k of PRICE_KEYS) expect(keys.has(k), `${k} in receiving payload`).toBe(false);
        expect(view!.lines[0]!.remainingQty).toBe("8.00");
        expect(JSON.stringify(view)).not.toMatch(/45000|450000|455000/);
      }
      await expect(getPurchaseOrderView(po.id, { ...staff, isAdmin: false })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPurchaseOrderPrint(po.id, staff)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listPurchaseOrdersView({}, viewer)).rejects.toBeInstanceOf(ForbiddenError);

      // RR attachment: stored, downloadable by anyone with "view".
      const att = await db.documentAttachment.findFirstOrThrow({ where: { receivingReportId: rr.id } });
      expect(readFileSync(path.join(process.env.UPLOAD_DIR!, att.storageKey))).toEqual(Buffer.from(PNG));
      expect((await attachmentDownload(viewer, att.id)).status).toBe(200);
      expect((await attachmentDownload(null, att.id)).status).toBe(401);
      // A file that isn't really a PNG is refused and nothing is posted.
      const fake = new TextEncoder().encode("not an image at all");
      await expect(postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "1" }], staff.id), staff, [{ name: "x.png", size: fake.length, bytes: fake }])).rejects.toThrow(/real PDF, JPG or PNG/);
      expect(await db.receivingReport.count({ where: { purchaseOrderId: po.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("supplier bills and the 3-way match", () => {
    it("flags a unit price difference and bill-vs-received; bill numbers are unique per supplier until voided", async () => {
      const year = await freshYear();
      const { po, lines } = await sentPo(year);
      const [laptop, mouse] = lines;
      await postReceivingReport(po.id, receipt(year, [{ lineId: laptop!.id, qty: "10" }, { lineId: mouse!.id, qty: "10" }], staff.id), staff);
      const billNo = `SI-${tag()}`;
      await expect(recordSupplierBill(po.id, { billNumber: billNo, billDate: new Date(Date.UTC(year, 3, 5)), amount: "1", notes: null, lines: [] }, staff)).rejects.toBeInstanceOf(ForbiddenError);
      const bill = await recordSupplierBill(
        po.id,
        {
          billNumber: billNo,
          billDate: new Date(Date.UTC(year, 3, 5)),
          amount: "457500.00",
          notes: null,
          lines: [
            { purchaseOrderItemId: laptop!.id, qty: "10", unitPrice: "45250" },
            { purchaseOrderItemId: mouse!.id, qty: "10", unitPrice: "500" },
          ],
        },
        buyer,
        [{ name: "invoice.png", size: PNG.length, bytes: PNG }],
      );
      const view = (await getPurchaseOrderView(po.id, { ...admin, isAdmin: true }))!;
      expect(view.match.status).toBe("MISMATCH");
      expect(view.match.lines[0]!.status).toBe("PRICE_MISMATCH");
      expect(view.match.lines[0]!.priceDifferenceTotal).toBe("2500.00");
      expect(view.match.lines[1]!.status).toBe("MATCHED");
      expect(view.match.headerFlags.map((f) => f.code)).toEqual(["BILLED_DIFFERS_FROM_RECEIVED"]);

      await expect(
        recordSupplierBill(po.id, { billNumber: billNo.toLowerCase(), billDate: new Date(Date.UTC(year, 3, 6)), amount: "1", notes: null, lines: [] }, buyer),
      ).rejects.toThrow(/already has a bill with that number/);

      // Bill attachments are cost data.
      const att = await db.documentAttachment.findFirstOrThrow({ where: { supplierBillId: bill.id } });
      expect((await attachmentDownload(staff, att.id)).status).toBe(403);
      expect((await attachmentDownload(admin, att.id)).status).toBe(200);

      await voidSupplierBill(bill.id, "Supplier reissued", buyer);
      const reissued = await recordSupplierBill(po.id, { billNumber: billNo, billDate: new Date(Date.UTC(year, 3, 7)), amount: "455000.00", notes: null, lines: [] }, buyer);
      expect(reissued.status).toBe("RECORDED");
      const matched = (await getPurchaseOrderView(po.id, { ...admin, isAdmin: true }))!;
      expect(matched.match.headerFlags).toEqual([]);
      expect(await db.documentVoid.count({ where: { docType: "SUPPLIER_BILL", docId: bill.id } })).toBe(1);
    });

    it("bills need a sent PO", async () => {
      const year = await freshYear();
      const { so } = await salesOrder(year);
      const [po] = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year), buyer);
      await expect(recordSupplierBill(po!.id, { billNumber: "X1", billDate: new Date(Date.UTC(year, 3, 5)), amount: "1", notes: null, lines: [] }, buyer)).rejects.toThrow(DocRuleError);
    });
  });

  // -------------------------------------------------------------------------
  describe("transactions tab", () => {
    it("lists POs, RRs and bills for cost users only; totals exclude void", async () => {
      const year = await freshYear();
      const { po, lines, a, customer, so } = await sentPo(year);
      await postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "2" }], staff.id), staff);
      await recordSupplierBill(po.id, { billNumber: `T-${tag()}`, billDate: new Date(Date.UTC(year, 3, 5)), amount: "90000", notes: null, lines: [] }, buyer);
      const [extra] = await createPurchaseOrdersFromSalesOrder(so.id, fromSo(year, { supplierPicks: { [(await db.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: so.id, supplierId: null } })).id]: a.id } }), buyer);
      await voidPurchaseOrder(extra!.id, "dup", buyer);

      const list = await listTransactions({ kind: "supplier", id: a.id }, {}, admin);
      const kinds = list.rows.map((r) => r.kind);
      expect(kinds).toEqual(expect.arrayContaining(["PURCHASE_ORDER", "RECEIVING_REPORT", "SUPPLIER_BILL", "QUOTE", "SALES_ORDER"]));
      const poTotals = list.totals.find((t) => t.kind === "PURCHASE_ORDER")!;
      expect(poTotals).toMatchObject({ count: 1, voidCount: 1, total: "455000.00" });
      expect(list.totals.find((t) => t.kind === "RECEIVING_REPORT")).toMatchObject({ count: 1, total: "90000.00" });
      expect(list.totals.find((t) => t.kind === "SUPPLIER_BILL")).toMatchObject({ count: 1, total: "90000.00" });

      const onlyPos = await listTransactions({ kind: "supplier", id: a.id }, { type: "PURCHASE_ORDER", status: "PARTIALLY_RECEIVED" }, admin);
      expect(onlyPos.rows.map((r) => r.id)).toEqual([po.id]);

      expect((await listTransactions({ kind: "supplier", id: a.id }, {}, staff)).restricted).toBe(true);
      const customerStaff = await listTransactions({ kind: "customer", id: customer.id }, {}, staff);
      expect(customerStaff.rows.some((r) => ["PURCHASE_ORDER", "RECEIVING_REPORT", "SUPPLIER_BILL"].includes(r.kind))).toBe(false);
      const customerAdmin = await listTransactions({ kind: "customer", id: customer.id }, { type: "PURCHASE_ORDER" }, admin);
      const soPos = await db.purchaseOrder.findMany({ where: { salesOrderId: so.id }, select: { id: true } });
      expect(soPos).toHaveLength(3); // supplier A, supplier B, and the voided extra one
      expect(customerAdmin.rows.map((r) => r.id).sort()).toEqual(soPos.map((p) => p.id).sort());
      expect(customerAdmin.rows.map((r) => r.id)).toContain(extra!.id);
    });
  });

  // -------------------------------------------------------------------------
  describe("migration", () => {
    it("adds the receivingReport numbering version once (running it again adds nothing)", async () => {
      const sql = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261030140000_purchase_orders_receiving/migration.sql"), "utf8");
      const block = sql.slice(sql.indexOf("-- BEGIN receiving report numbering"), sql.indexOf("-- END receiving report numbering"));
      const stmt = block
        .split("\n")
        .filter((l) => !l.startsWith("--"))
        .join("\n")
        .trim()
        .replace(/;$/, "");
      // Simulate a database whose latest settings predate receiving reports.
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      const data = JSON.parse(JSON.stringify(latest.data)) as { numbering: Record<string, unknown> };
      delete data.numbering.receivingReport;
      await db.settingsVersion.create({ data: { version: latest.version + 1, data: data as never, changedKey: "test" } });
      await db.$executeRawUnsafe(stmt);
      await db.$executeRawUnsafe(stmt); // second run adds nothing
      const after = await db.settingsVersion.findMany({ where: { version: { gt: latest.version } }, orderBy: { version: "asc" } });
      expect(after).toHaveLength(2);
      expect(after[1]!.id).toBe(`mig_rr_numbering_${latest.version + 2}`);
      expect((after[1]!.data as { numbering: { receivingReport: unknown } }).numbering.receivingReport).toEqual({ prefix: "RR", padding: 4, resetYearly: true });
      const { settings } = await getSettingsSnapshot();
      expect(settings.numbering.receivingReport.prefix).toBe("RR");
    });
  });

  function standalone(supplierId: string, year: number): PoInput {
    return {
      supplierId,
      supplierContactId: null,
      date: new Date(Date.UTC(year, 5, 1)),
      expectedDate: null,
      terms: null,
      deliveryAddressText: null,
      supplierAddressText: null,
      notes: null,
      items: [{ id: null, description: "Toner", kind: "GOODS", qty: "3", unit: "pc", unitCost: "2500" }],
    };
  }
});
