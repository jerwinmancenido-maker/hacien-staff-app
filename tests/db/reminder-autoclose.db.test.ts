// Adoption item 13: assignment reminders auto-close when their record
// reaches a done state. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.
// Pins:
// - QUOTE: converted (WON) / marked LOST / VOID closes open reminders with
//   the matching reason; approval alone does NOT (quote is still live).
// - SALES_ORDER: fully delivered closes ("order fully delivered") even while
//   the order is still OPEN for billing; VOID closes; partial delivery not.
// - PURCHASE_ORDER: fully RECEIVED closes; CLOSED (incl. short-close) and
//   VOID close; PARTIALLY_RECEIVED does not.
// - A reminder closed by hand first is untouched (doneAt kept, no reason).
// - Home overdue count = the viewer's own open, past-date reminders only.

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
import { manilaToday } from "@/lib/format";
import { loadHomeDashboard } from "@/lib/home/dashboard";
import {
  approveQuote,
  convertQuoteToSalesOrder,
  createQuote,
  markQuoteLost,
  voidQuote,
  type DocActor,
} from "@/lib/services/quotes";
import { voidSalesOrder } from "@/lib/services/sales-orders";
import { recordDelivery } from "@/lib/services/deliveries";
import {
  approvePurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrdersFromSalesOrder,
  markPurchaseOrderSent,
  voidPurchaseOrder,
} from "@/lib/services/purchase-orders";
import { postReceivingReport } from "@/lib/services/receiving";
import {
  countMyOverdueReminders,
  createReminder,
  listMyReminders,
  setReminderDone,
} from "@/lib/services/reminders";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

async function ensureWideDrBooklet(adminId: string) {
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
          data: {
            ...(latest.data as object),
            invoiceBooklet: { ...ib, deliveryReceipt: { ...typeWide } },
          } as never,
          changedKey: "invoiceBooklet",
          before: ib,
          after: { deliveryReceipt: typeWide },
          createdById: adminId,
        },
      });
      return;
    } catch {
      /* version race */
    }
  }
  throw new Error("ensureWideDrBooklet: could not widen the DR booklet");
}

const ymdStr = (d: Date) => d.toISOString().slice(0, 10);
const daysFromToday = (n: number) => {
  const d = manilaToday();
  d.setUTCDate(d.getUTCDate() + n);
  return ymdStr(d);
};

describe.skipIf(!env.hasDb)("reminder auto-close (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let drSeq = 770_000 + Math.floor(Math.random() * 10_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-ad13-uploads-"));
    admin = await makeUser("costs");
    staff = await makeUser("staff");
    await ensureWideDrBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function remind(userId: string, entityType: string, entityId: string, note = "follow up") {
    return createReminder(userId, { entityType, entityId, remindAt: daysFromToday(7), note });
  }

  async function reminderState(id: string) {
    return db.reminder.findUniqueOrThrow({ where: { id }, select: { doneAt: true, doneReason: true } });
  }

  async function makeQuote(year: number) {
    const customer = await makeCustomer();
    const q = await createQuote(quoteInput(customer.id, year), admin);
    return { customer, q };
  }

  async function makeSo(year: number, qty = "2") {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: `Auto-close goods ${tag()}`,
            kind: "GOODS" as const,
            qty,
            unit: "pcs",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "100",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `AC-${tag()}`, deliveryAddressId }, admin);
    const item = await db.salesOrderItem.findFirstOrThrow({
      where: { salesOrderId: so.id },
      orderBy: { sortOrder: "asc" },
    });
    return { customer, q, so, item };
  }

  async function makePo(year: number) {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: `Auto-close widget ${tag()}`,
            kind: "GOODS" as const,
            qty: "2",
            unit: "pc",
            supplierId: supplier.id,
            supplierUnitCost: "100",
            unitPrice: "500",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `AC-${tag()}`, deliveryAddressId }, admin);
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    return { customer, supplier, so, po: po! };
  }

  async function receive(poId: string, qty: string, year: number) {
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: poId } });
    return postReceivingReport(
      poId,
      {
        receivedDate: new Date(Date.UTC(year, 3, 1)),
        receivedById: admin.id,
        deliveryRef: `DR-AC-${tag()}`,
        notes: null,
        lines: lines.map((l) => ({ lineId: l.id, qty, warrantyEndDate: null, serialNumbers: null })),
      },
      admin,
    );
  }

  it("quote conversion auto-closes every owner's open reminders with the converted reason", async () => {
    const year = await freshYear();
    const { customer, q } = await makeQuote(year);
    const mine = await remind(admin.id, "QUOTE", q.id);
    const theirs = await remind(staff.id, "QUOTE", q.id);
    await approveQuote(q.id, admin);
    // Approval alone is NOT a done state: both reminders still open.
    expect((await reminderState(mine.id)).doneAt).toBeNull();
    expect((await reminderState(theirs.id)).doneAt).toBeNull();

    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    await convertQuoteToSalesOrder(q.id, { buyerPoNo: `AC-${tag()}`, deliveryAddressId }, admin);
    for (const r of [mine, theirs]) {
      const s = await reminderState(r.id);
      expect(s.doneAt).not.toBeNull();
      expect(s.doneReason).toBe("Auto-closed: quote converted to a sales order");
    }
    // The row surfaces the reason through the personal list.
    const listed = await listMyReminders(admin.id);
    expect(listed.find((r) => r.id === mine.id)?.doneReason).toBe(
      "Auto-closed: quote converted to a sales order",
    );
  });

  it("quote marked lost and quote voided auto-close with their reasons", async () => {
    const year = await freshYear();
    const lost = await makeQuote(year);
    const lostReminder = await remind(admin.id, "QUOTE", lost.q.id);
    await markQuoteLost(lost.q.id, admin);
    const lostState = await reminderState(lostReminder.id);
    expect(lostState.doneAt).not.toBeNull();
    expect(lostState.doneReason).toBe("Auto-closed: quote marked as lost");

    const voided = await makeQuote(year);
    const voidReminder = await remind(admin.id, "QUOTE", voided.q.id);
    await voidQuote(voided.q.id, "No longer needed", admin);
    const voidState = await reminderState(voidReminder.id);
    expect(voidState.doneAt).not.toBeNull();
    expect(voidState.doneReason).toBe("Auto-closed: quote voided");
  });

  it("a reminder closed by hand keeps its own doneAt and gains no reason when the record completes", async () => {
    const year = await freshYear();
    const { customer, q } = await makeQuote(year);
    const r = await remind(admin.id, "QUOTE", q.id);
    await setReminderDone(r.id, admin.id, true);
    const hand = await reminderState(r.id);
    expect(hand.doneAt).not.toBeNull();
    expect(hand.doneReason).toBeNull();

    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    await convertQuoteToSalesOrder(q.id, { buyerPoNo: `AC-${tag()}`, deliveryAddressId }, admin);
    const after = await reminderState(r.id);
    expect(after.doneAt?.getTime()).toBe(hand.doneAt?.getTime());
    expect(after.doneReason).toBeNull();
  });

  it("SO fully delivered auto-closes while still OPEN; partial delivery does not", async () => {
    const year = await freshYear();
    const { so, item } = await makeSo(year, "2");
    const r = await remind(admin.id, "SALES_ORDER", so.id);

    await recordDelivery(
      so.id,
      { drNumber: nextDr(), deliveryDate: new Date(), idSightChecked: false, items: [{ salesOrderItemId: item.id, qty: "1" }] },
      admin,
    );
    expect((await reminderState(r.id)).doneAt).toBeNull();

    await recordDelivery(
      so.id,
      { drNumber: nextDr(), deliveryDate: new Date(), idSightChecked: false, items: [{ salesOrderItemId: item.id, qty: "1" }] },
      admin,
    );
    const s = await reminderState(r.id);
    expect(s.doneAt).not.toBeNull();
    expect(s.doneReason).toBe("Auto-closed: order fully delivered");
    // The order itself is still OPEN (nothing billed/paid) — delivery was the trigger.
    const soNow = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, select: { status: true } });
    expect(soNow.status).toBe("OPEN");
  });

  it("SO voided auto-closes with the voided reason", async () => {
    const year = await freshYear();
    const { so } = await makeSo(year);
    const r = await remind(admin.id, "SALES_ORDER", so.id);
    await voidSalesOrder(so.id, "Ordered by mistake", admin);
    const s = await reminderState(r.id);
    expect(s.doneAt).not.toBeNull();
    expect(s.doneReason).toBe("Auto-closed: order voided");
  });

  it("PO fully received auto-closes; partial receipt does not", async () => {
    const year = await freshYear();
    const { po } = await makePo(year);
    const r = await remind(admin.id, "PURCHASE_ORDER", po.id);
    await approvePurchaseOrder(po.id, admin);
    await markPurchaseOrderSent(po.id, admin);

    await receive(po.id, "1", year);
    const mid = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, select: { status: true } });
    expect(mid.status).toBe("PARTIALLY_RECEIVED");
    expect((await reminderState(r.id)).doneAt).toBeNull();

    await receive(po.id, "1", year);
    const end = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, select: { status: true } });
    expect(end.status).toBe("RECEIVED");
    const s = await reminderState(r.id);
    expect(s.doneAt).not.toBeNull();
    expect(s.doneReason).toBe("Auto-closed: PO fully received");
  });

  it("PO short-close and PO void auto-close with their reasons", async () => {
    const year = await freshYear();
    const closing = await makePo(year);
    const closeReminder = await remind(admin.id, "PURCHASE_ORDER", closing.po.id);
    await approvePurchaseOrder(closing.po.id, admin);
    await markPurchaseOrderSent(closing.po.id, admin);
    await receive(closing.po.id, "1", year);
    await closePurchaseOrder(closing.po.id, "Supplier cannot supply the rest", admin);
    const closeState = await reminderState(closeReminder.id);
    expect(closeState.doneAt).not.toBeNull();
    expect(closeState.doneReason).toBe("Auto-closed: PO closed");

    const voiding = await makePo(year);
    const voidReminder = await remind(admin.id, "PURCHASE_ORDER", voiding.po.id);
    await voidPurchaseOrder(voiding.po.id, "Raised in error", admin);
    const voidState = await reminderState(voidReminder.id);
    expect(voidState.doneAt).not.toBeNull();
    expect(voidState.doneReason).toBe("Auto-closed: PO voided");
  });

  it("Home overdue count is the viewer's own open past-date reminders only", async () => {
    const year = await freshYear();
    const { q } = await makeQuote(year);
    const baseAdmin = (await loadHomeDashboard(admin)).counts.overdueReminders;
    expect(baseAdmin).not.toBeNull();
    expect(baseAdmin!.label).toBe("Overdue reminders");
    expect(baseAdmin!.href).toBe("/reminders#overdue");
    const baseCount = baseAdmin!.count;
    const baseStaff = (await loadHomeDashboard(staff)).counts.overdueReminders!.count;

    // Admin: two overdue open, one future open, one overdue already done.
    await createReminder(admin.id, { entityType: "QUOTE", entityId: q.id, remindAt: daysFromToday(-2), note: "overdue one" });
    await createReminder(admin.id, { entityType: "QUOTE", entityId: q.id, remindAt: daysFromToday(-1), note: "overdue two" });
    await createReminder(admin.id, { entityType: "QUOTE", entityId: q.id, remindAt: daysFromToday(3), note: "future" });
    const doneOverdue = await createReminder(admin.id, {
      entityType: "QUOTE",
      entityId: q.id,
      remindAt: daysFromToday(-3),
      note: "already done",
    });
    await setReminderDone(doneOverdue.id, admin.id, true);
    // Staff: one overdue open — must not leak into admin's count.
    await createReminder(staff.id, { entityType: "QUOTE", entityId: q.id, remindAt: daysFromToday(-1), note: "staff overdue" });

    expect(await countMyOverdueReminders(admin.id, manilaToday())).toBe(baseCount + 2);
    const counts = (await loadHomeDashboard(admin)).counts;
    expect(counts.overdueReminders!.count).toBe(baseCount + 2);
    const staffCounts = (await loadHomeDashboard(staff)).counts;
    expect(staffCounts.overdueReminders!.count).toBe(baseStaff + 1);
  });
});
