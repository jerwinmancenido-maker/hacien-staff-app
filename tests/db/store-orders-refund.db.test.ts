// Store-order refund / chargeback mirror (Slice 3) against MySQL 8
// (TEST_DATABASE_URL): the full mirror (collection → billing → sales
// order → gateway fee expense, each voided by its own service), resume
// from a pre-voided step, the period-closed refusal changing nothing,
// refund on an unconverted order refused, double-refund refused, the
// no-fee chain, PROVISIONING + the derived DONE status, and the 45-day
// renewal filter's include/exclude rules.

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  // The mirror fee-expense step goes through voidExpense, whose own
  // contract requires the Cash feature - the house pattern (cash suites
  // set the env flag for the file).
  process.env.CASH_ENABLED = "true";
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { createStoreOrderFromApi } from "@/lib/store-orders/intake";
import { convertStoreOrder } from "@/lib/store-orders/convert";
import {
  gatewayFeeExpenseNotes,
  getStoreOrderMirrorState,
  markStoreOrderProvisioning,
  refundStoreOrder,
} from "@/lib/store-orders/refund";
import { getStoreOrderConversionPrep, getStoreOrderDetail, listStoreOrders } from "@/lib/store-orders/views";
import { voidCollection } from "@/lib/services/collections";
import { closePeriod, reopenPeriod, yearMonthOf } from "@/lib/services/period-close";
import { makeUser, tag } from "./fixtures";

function orderBody(t: string, overrides: Record<string, unknown> = {}) {
  return {
    gateway: { name: "TestPay", paymentRef: `pay-${t}`, idempotencyKey: `gw-${t}` },
    paidAt: "2026-11-27T02:00:00.000Z",
    amountPaid: "1150.00",
    gatewayFee: "17.25",
    deliveryFee: "150.00",
    currency: "PHP",
    buyer: { name: `Web Buyer ${t}`, email: `buyer-${t}@example.com`, phone: "09171234567" },
    deliveryAddress: {
      label: "Home",
      street: "1 Test St",
      barangay: "Brgy Test",
      cityMunicipality: "Pasig",
      province: "Metro Manila",
      zip: "1600",
    },
    lines: [{ sku: null, title: "Test Widget", qty: "2", unit: "pc", unitPrice: "500.00", termEndDate: null }],
    ...overrides,
  };
}

async function intake(t: string, overrides: Record<string, unknown> = {}) {
  const actor = await makeUser("costs");
  const result = await createStoreOrderFromApi(orderBody(t, overrides), actor);
  const row = await db.storeOrder.findUniqueOrThrow({
    where: { id: result.order.id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  return row;
}

async function prepSi(orderId: string): Promise<number> {
  const prep = await getStoreOrderConversionPrep(orderId);
  expect(prep).not.toBeNull();
  expect(prep!.nextSi).not.toBeNull();
  return prep!.nextSi!;
}

async function convertedOrder(t: string, overrides: Record<string, unknown> = {}) {
  const admin = await makeUser("costs");
  const order = await intake(t, overrides);
  const si = await prepSi(order.id);
  // Lines with no catalogue item are flagged at intake; conversion
  // requires each one resolved — keep them as free text (null pick).
  const lineItemPicks: Record<string, string | null> = {};
  for (const line of order.lines) {
    if (!line.itemId) lineItemPicks[line.id] = null;
  }
  const result = await convertStoreOrder(order.id, { customerMode: "new", invoiceNo: si, lineItemPicks }, admin);
  return { admin, order, si, converted: result };
}

async function chainStatuses(salesOrderId: string) {
  const so = await db.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId } });
  const billings = await db.billing.findMany({ where: { salesOrderId } });
  const allocations = await db.collectionAllocation.findMany({
    where: { billingId: { in: billings.map((b) => b.id) } },
    include: { collection: true },
  });
  return { so, billings, collections: allocations.map((a) => a.collection) };
}

describe("store-orders refund mirror", () => {
  it("runs the full mirror: all four documents void, terminal status + audit land", async () => {
    if (!env.hasDb) return;
    const { admin, order, si, converted } = await convertedOrder(tag());

    const before = await getStoreOrderMirrorState(order.id);
    expect(before).not.toBeNull();
    expect(before!.totalCount).toBe(4); // collection, billing, SO, fee expense
    expect(before!.doneCount).toBe(0);
    expect(before!.complete).toBe(false);
    expect(before!.steps.map((s) => s.key)).toEqual(["collection", "billing", "salesOrder", "feeExpense"]);

    const result = await refundStoreOrder(order.id, { kind: "REFUNDED", reason: "Buyer asked for a refund" }, admin);
    expect(result.status).toBe("REFUNDED");

    const stored = await db.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("REFUNDED");

    const { so, billings, collections } = await chainStatuses(converted.salesOrderId);
    expect(so.status).toBe("VOID");
    expect(billings).toHaveLength(1);
    expect(billings[0]?.status).toBe("VOID");
    // The booklet SI stays claimed — voided numbers are never reused.
    expect(billings[0]?.invoiceNo).toBe(si);
    expect(collections).toHaveLength(1);
    expect(collections[0]?.status).toBe("VOID");

    const fee = await db.expense.findFirst({
      where: { salesOrderId: converted.salesOrderId, notes: gatewayFeeExpenseNotes(order.number, order.gatewayPaymentRef) },
    });
    expect(fee).not.toBeNull();
    expect(fee!.status).toBe("VOID");
    expect(fee!.amount.toFixed(2)).toBe("17.25");

    const after = await getStoreOrderMirrorState(order.id);
    expect(after!.complete).toBe(true);
    expect(after!.doneCount).toBe(4);

    // Every void left its DocumentVoid snapshot.
    const docIds = [collections[0]!.id, billings[0]!.id, so.id, fee!.id];
    expect(await db.documentVoid.count({ where: { docId: { in: docIds } } })).toBe(4);

    // The terminal status change is audited under the acting user, naming
    // the kind and the gateway payment reference.
    const audits = await db.auditLog.findMany({
      where: { entityType: "StoreOrder", entityId: order.id, action: "update" },
      orderBy: { at: "desc" },
      take: 5,
    });
    const refundAudit = audits.find((a) => (a.after as { kind?: string } | null)?.kind === "refund");
    expect(refundAudit).toBeDefined();
    expect(refundAudit!.userId).toBe(admin.id);
    expect((refundAudit!.after as { paymentRef?: string }).paymentRef).toBe(order.gatewayPaymentRef);
    expect((refundAudit!.after as { status?: string }).status).toBe("REFUNDED");
  });

  it("resumes from a pre-voided collection and finishes as a chargeback", async () => {
    if (!env.hasDb) return;
    const { admin, order, converted } = await convertedOrder(tag());

    const state = await getStoreOrderMirrorState(order.id);
    const collectionStep = state!.steps.find((s) => s.key === "collection")!;
    await voidCollection(collectionStep.docId, "Gateway reversed the payment first", admin);

    const mid = await getStoreOrderMirrorState(order.id);
    expect(mid!.doneCount).toBe(1);
    expect(mid!.complete).toBe(false);

    const result = await refundStoreOrder(order.id, { kind: "CHARGEBACK", reason: "Chargeback raised by the bank" }, admin);
    expect(result.status).toBe("CHARGEBACK");

    const { so, billings, collections } = await chainStatuses(converted.salesOrderId);
    expect(so.status).toBe("VOID");
    expect(billings[0]?.status).toBe("VOID");
    expect(collections[0]?.status).toBe("VOID");
    // The pre-voided collection was skipped, not voided twice.
    expect(await db.documentVoid.count({ where: { docId: collectionStep.docId } })).toBe(1);

    const stored = await db.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("CHARGEBACK");
  });

  it("refuses on a closed period and changes nothing, then completes after reopen", async () => {
    if (!env.hasDb) return;
    const { admin, order, converted } = await convertedOrder(tag());
    const ym = yearMonthOf(new Date());
    await closePeriod(ym, admin);
    try {
      await expect(
        refundStoreOrder(order.id, { kind: "REFUNDED", reason: "Refund during closed period" }, admin),
      ).rejects.toThrow(/clos/i);

      const { so, billings, collections } = await chainStatuses(converted.salesOrderId);
      expect(collections[0]?.status).toBe("POSTED");
      expect(billings[0]?.status).not.toBe("VOID");
      expect(so.status).toBe("OPEN");
      const fee = await db.expense.findFirst({ where: { salesOrderId: converted.salesOrderId } });
      expect(fee?.status).toBe("POSTED");
      const stored = await db.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(stored.status).toBe("CONFIRMED");
    } finally {
      await reopenPeriod(ym, "Refund mirror test cleanup", admin);
    }
    // Resumable: after reopening, the same call completes the mirror.
    const result = await refundStoreOrder(order.id, { kind: "REFUNDED", reason: "Refund after reopen" }, admin);
    expect(result.status).toBe("REFUNDED");
  });

  it("refuses a refund on a PAID (unconverted) order and refuses PROVISIONING there too", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const order = await intake(tag());
    await expect(refundStoreOrder(order.id, { kind: "REFUNDED", reason: "Too early" }, admin)).rejects.toThrow(
      /not been converted/,
    );
    await expect(markStoreOrderProvisioning(order.id, admin)).rejects.toThrow(/Only a converted/);
    const stored = await db.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("PAID");
  });

  it("refuses a second terminal marking (double-refund)", async () => {
    if (!env.hasDb) return;
    const { admin, order } = await convertedOrder(tag());
    await refundStoreOrder(order.id, { kind: "REFUNDED", reason: "First refund" }, admin);
    await expect(refundStoreOrder(order.id, { kind: "REFUNDED", reason: "Second refund" }, admin)).rejects.toThrow(
      /already marked/,
    );
    await expect(refundStoreOrder(order.id, { kind: "CHARGEBACK", reason: "Flip to chargeback" }, admin)).rejects.toThrow(
      /already/,
    );
  });

  it("mirrors a zero-fee order: three steps, no fee expense", async () => {
    if (!env.hasDb) return;
    const { admin, order, converted } = await convertedOrder(tag(), { gatewayFee: "0.00" });
    const before = await getStoreOrderMirrorState(order.id);
    expect(before!.totalCount).toBe(3);
    expect(before!.steps.map((s) => s.key)).toEqual(["collection", "billing", "salesOrder"]);
    const result = await refundStoreOrder(order.id, { kind: "REFUNDED", reason: "No-fee refund" }, admin);
    expect(result.status).toBe("REFUNDED");
    const { so } = await chainStatuses(converted.salesOrderId);
    expect(so.status).toBe("VOID");
  });

  it("PROVISIONING is staff-set on a converted order; DONE derives from the SO closing", async () => {
    if (!env.hasDb) return;
    const { admin, order, converted } = await convertedOrder(tag());

    let detail = await getStoreOrderDetail(order.id);
    expect(detail!.displayStatus).toBe("CONFIRMED");

    await markStoreOrderProvisioning(order.id, admin);
    detail = await getStoreOrderDetail(order.id);
    expect(detail!.status).toBe("PROVISIONING");
    expect(detail!.displayStatus).toBe("PROVISIONING");

    // The derivation is the unit under test here (the SO close machinery
    // itself is existing, separately covered): flip the SO to CLOSED and
    // the order reads DONE without any status write of its own.
    await db.salesOrder.update({ where: { id: converted.salesOrderId }, data: { status: "CLOSED" } });
    detail = await getStoreOrderDetail(order.id);
    expect(detail!.status).toBe("PROVISIONING");
    expect(detail!.displayStatus).toBe("DONE");
  });

  it("renewal filter: in-window term included, far term and refunded order excluded", async () => {
    if (!env.hasDb) return;
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const sub = (termEndDate: string) => ({
      amountPaid: "1000.00",
      gatewayFee: "0.00",
      deliveryFee: "0.00",
      lines: [{ sku: null, title: "Subscription Widget", qty: "1", unit: "pc", unitPrice: "1000.00", termEndDate }],
    });

    const near = await intake(tag(), sub(inDays(20)));
    const far = await intake(tag(), sub(inDays(90)));
    const { admin, order: refundedOrder } = await convertedOrder(tag(), sub(inDays(10)));
    await refundStoreOrder(refundedOrder.id, { kind: "REFUNDED", reason: "Renewal exclusion check" }, admin);

    const { rows } = await listStoreOrders({ renewalsOnly: true, page: 1 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(far.id);
    expect(ids).not.toContain(refundedOrder.id);
    const nearRow = rows.find((r) => r.id === near.id);
    expect(nearRow!.nextTermEndDate).not.toBeNull();
  });
});
