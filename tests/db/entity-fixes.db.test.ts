// Entity fixes (REQ-HACIEN-MAC-TEST-004 follow-ups, PR-9): the gap-state
// predicates behind the SO/PO gap-reason editors (E7) and the payables
// aging split for other businesses' bills (E3).
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { apAgingSummary } from "@/lib/payables/views";
import { recordBilling } from "@/lib/services/billings";
import { saveBusiness } from "@/lib/services/businesses";
import { recordDelivery } from "@/lib/services/deliveries";
import { createPurchaseOrdersFromSalesOrder, markPurchaseOrderSent } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { postReceivingReport } from "@/lib/services/receiving";
import { purchaseOrderGapState, salesOrderGapState } from "@/lib/services/reconciliation";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { getSettingsSnapshot } from "@/lib/settings";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("entity fixes: gap state + payables split (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 880_000 + Math.floor(Math.random() * 40_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 720_000 + Math.floor(Math.random() * 40_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    admin = await makeUser("costs");
    await ensureWideBooklet();
    await ensureWideDrBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet entity-fixes" };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.invoiceBooklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1,
            data: { ...(latest.data as object), invoiceBooklet: wide } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: wide,
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // Unique version race with another suite — retry.
      }
    }
  }

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

  /** Quote → SO → PO. Contract 2 × 5000 = 10000; PO cost 2 × 2000 = 4000. */
  async function makeChain(year: number, businessId: string | null) {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        businessId,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "2000", unitPrice: "5000" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-EF-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const items = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      {
        date: new Date(Date.UTC(year, 2, 3)),
        expectedDate: null,
        deliveryAddressText: null,
        supplierPicks: {},
        idempotencyKey: `ef-${year}-${tag()}`.slice(0, 64),
        rows: [{ key: items[0]!.id, supplierId: supplier.id, qty: "2" }],
      },
      admin,
    );
    await markPurchaseOrderSent(po!.id, admin);
    return { customer, supplier, so, po: po!, soItemId: items[0]!.id };
  }

  it("E7 SO gap state: open while anything is unbilled, partial once billing starts, closed when fully billed", async () => {
    const year = await freshYear();
    const chain = await makeChain(year, null);
    expect(await salesOrderGapState(chain.so.id)).toEqual({ show: true, partial: false });

    await recordDelivery(
      chain.so.id,
      {
        drNumber: nextDr(),
        deliveryDate: new Date(Date.UTC(year, 2, 6)),
        idSightChecked: false,
        items: [{ salesOrderItemId: chain.soItemId, qty: "2.00" }],
      },
      admin,
    );
    expect(await salesOrderGapState(chain.so.id)).toEqual({ show: true, partial: false });

    await recordBilling(
      {
        salesOrderId: chain.so.id,
        amount: "4000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    expect(await salesOrderGapState(chain.so.id)).toEqual({ show: true, partial: true });

    await recordBilling(
      {
        salesOrderId: chain.so.id,
        amount: "6000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 8)),
        dueDate: new Date(Date.UTC(year, 3, 7)),
        notes: null,
      },
      admin,
    );
    expect(await salesOrderGapState(chain.so.id)).toEqual({ show: false, partial: true });
  });

  it("E7 PO gap state: opens on receipt, partial on a part bill, closes when bills cover receipts", async () => {
    const year = await freshYear();
    const chain = await makeChain(year, null);
    expect(await purchaseOrderGapState(chain.po.id)).toEqual({ show: false, partial: false });

    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: chain.po.id }, orderBy: { sortOrder: "asc" } });
    await postReceivingReport(
      chain.po.id,
      {
        receivedDate: new Date(Date.UTC(year, 2, 7)),
        receivedById: admin.id,
        deliveryRef: `DR-EF-${tag()}`,
        notes: null,
        lines: [{ lineId: lines[0]!.id, qty: "2" }],
      },
      admin,
    );
    expect(await purchaseOrderGapState(chain.po.id)).toEqual({ show: true, partial: false });

    await recordSupplierBill(
      chain.po.id,
      { billNumber: `SB-EF-${tag()}`, billDate: new Date(Date.UTC(year, 2, 9)), amount: "1500.00", notes: null, lines: [] },
      admin,
    );
    expect(await purchaseOrderGapState(chain.po.id)).toEqual({ show: true, partial: true });

    await recordSupplierBill(
      chain.po.id,
      { billNumber: `SB-EF-${tag()}`, billDate: new Date(Date.UTC(year, 2, 10)), amount: "2500.00", notes: null, lines: [] },
      admin,
    );
    expect(await purchaseOrderGapState(chain.po.id)).toEqual({ show: false, partial: true });
  });

  it("E3: the payables aging split counts only bills on tagged POs as other-business", async () => {
    const year = await freshYear();
    const biz = await saveBusiness({ name: `EF Biz ${tag()}`, shortLabel: "EFB" }, admin);
    const before = await apAgingSummary();

    const tagged = await makeChain(year, biz.id);
    await recordSupplierBill(
      tagged.po.id,
      { billNumber: `SB-EF-T-${tag()}`, billDate: new Date(Date.UTC(year, 2, 9)), amount: "4000.00", notes: null, lines: [] },
      admin,
    );
    const own = await makeChain(year, null);
    await recordSupplierBill(
      own.po.id,
      { billNumber: `SB-EF-O-${tag()}`, billDate: new Date(Date.UTC(year, 2, 9)), amount: "4000.00", notes: null, lines: [] },
      admin,
    );

    const after = await apAgingSummary();
    const otherDelta = Number(after.otherBusinessPayable) - Number(before.otherBusinessPayable);
    const totalDelta = Number(after.totalPayable) - Number(before.totalPayable);
    expect(otherDelta).toBe(4000);
    expect(totalDelta).toBe(8000);
  });
});
