// Reconciliation (Reconciliation Plan 2026-11-19, PR-C): the four gap
// lists, the per-business filter, the document-status reasons, and the
// operational profit view (recorded orders, per business) staying
// separate from the official billed figure.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { saveBusiness } from "@/lib/services/businesses";
import { recordBilling } from "@/lib/services/billings";
import { recordDelivery } from "@/lib/services/deliveries";
import { recordExpense } from "@/lib/services/expenses";
import { createCashAccount, type CashActor } from "@/lib/services/cash-accounts";
import { createPurchaseOrdersFromSalesOrder, markPurchaseOrderSent } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { postReceivingReport } from "@/lib/services/receiving";
import {
  getOperationalProfit,
  getReconciliation,
  setPurchaseOrderGapReason,
  setSalesOrderGapReason,
} from "@/lib/services/reconciliation";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { getSettingsSnapshot } from "@/lib/settings";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("reconciliation + operational profit (MySQL)", () => {
  let admin: DocActor & CashActor;
  let staff: DocActor;
  let categoryId: string;
  let accountId: string;
  let invoiceSeq = 860_000 + Math.floor(Math.random() * 40_000);
  const nextInvoice = () => ++invoiceSeq;
  let drSeq = 700_000 + Math.floor(Math.random() * 40_000);
  const nextDr = () => String(++drSeq);

  beforeAll(async () => {
    process.env.CASH_ENABLED = "true";
    admin = await makeUser("costs");
    staff = await makeUser("staff");
    const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!cat) throw new Error("ExpenseCategory seed missing — run migrations on TEST_DATABASE_URL.");
    categoryId = cat.id;
    const year = await freshYear();
    const account = await createCashAccount(
      {
        name: `ReconAcct-${tag()}`,
        type: "BANK",
        bankName: "Test Bank",
        accountHintLast4: "1234",
        openingBalance: "100000.00",
        openingDate: new Date(Date.UTC(year, 0, 1)),
        active: true,
      },
      admin,
    );
    accountId = account.id;
    await ensureWideBooklet();
    await ensureWideDrBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet recon" };
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

  /** Quote → SO → PO. Contract 2 × 5000 = 10000; PO cost 2 × 2000 = 4000. March dates. */
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
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-RC-${tag()}`, deliveryAddressId }, admin, {
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
        idempotencyKey: `rc-${year}-${tag()}`.slice(0, 64),
        rows: [{ key: items[0]!.id, supplierId: supplier.id, qty: "2" }],
      },
      admin,
    );
    return { customer, supplier, so, po: po!, soItemId: items[0]!.id };
  }

  async function deliver(soId: string, soItemId: string, year: number) {
    return recordDelivery(
      soId,
      {
        drNumber: nextDr(),
        deliveryDate: new Date(Date.UTC(year, 2, 6)),
        idSightChecked: false,
        items: [{ salesOrderItemId: soItemId, qty: "2.00" }],
      },
      admin,
    );
  }

  async function bill(soId: string, year: number, amount: string) {
    return recordBilling(
      {
        salesOrderId: soId,
        amount,
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
  }

  async function receive(poId: string, year: number) {
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: poId }, orderBy: { sortOrder: "asc" } });
    return postReceivingReport(
      poId,
      {
        receivedDate: new Date(Date.UTC(year, 2, 7)),
        receivedById: admin.id,
        deliveryRef: `DR-RC-${tag()}`,
        notes: null,
        lines: [{ lineId: lines[0]!.id, qty: "2" }],
      },
      admin,
    );
  }

  it("the four lists open and close as documents catch up", async () => {
    const year = await freshYear();
    const chain = await makeChain(year, null);
    await markPurchaseOrderSent(chain.po.id, admin);

    // Delivered, not billed.
    await deliver(chain.so.id, chain.soItemId, year);
    let recon = await getReconciliation(admin, "all");
    const dnb = recon.deliveredNotBilled.rows.find((r) => r.id === chain.so.id);
    expect(dnb?.amount).toBe("10000.00");
    expect(dnb?.detail).toContain("nothing billed");
    expect(recon.billedNotDelivered.rows.some((r) => r.id === chain.so.id)).toBe(false);

    // GRNI: received 2 × 2000 = 4000, no supplier bill yet.
    await receive(chain.po.id, year);
    recon = await getReconciliation(admin, "all");
    const grni = recon.receivedNotInvoiced.rows.find((r) => r.id === chain.po.id);
    expect(grni?.amount).toBe("4000.00");

    // Bill the SO in full → delivered-not-billed closes.
    await bill(chain.so.id, year, "10000.00");
    recon = await getReconciliation(admin, "all");
    expect(recon.deliveredNotBilled.rows.some((r) => r.id === chain.so.id)).toBe(false);

    // Record the supplier bill in full → GRNI closes.
    await recordSupplierBill(
      chain.po.id,
      { billNumber: `SB-RC-${tag()}`, billDate: new Date(Date.UTC(year, 2, 9)), amount: "4000.00", notes: null, lines: [] },
      admin,
    );
    recon = await getReconciliation(admin, "all");
    expect(recon.receivedNotInvoiced.rows.some((r) => r.id === chain.po.id)).toBe(false);
    expect(recon.billNotReceived.rows.some((r) => r.number.startsWith("SB-RC-"))).toBe(false);

    // A second chain: billed with NO delivery → billed-not-delivered;
    // supplier bill with NO receiving → bill-not-received.
    const chain2 = await makeChain(year, null);
    await markPurchaseOrderSent(chain2.po.id, admin);
    await bill(chain2.so.id, year, "10000.00");
    const orphanBill = await recordSupplierBill(
      chain2.po.id,
      { billNumber: `SB-RC-ORPHAN-${tag()}`, billDate: new Date(Date.UTC(year, 2, 9)), amount: "4000.00", notes: null, lines: [] },
      admin,
    );
    recon = await getReconciliation(admin, "all");
    const bnd = recon.billedNotDelivered.rows.find((r) => r.id === chain2.so.id);
    expect(bnd?.amount).toBe("10000.00");
    const bnr = recon.billNotReceived.rows.find((r) => r.id === orphanBill.id);
    expect(bnr?.amount).toBe("4000.00");
    expect(bnr?.detail).toContain(chain2.po.number);
  });

  it("the business filter separates own-company rows from tagged rows", async () => {
    const year = await freshYear();
    const biz = await saveBusiness({ name: `Recon Biz ${tag()}`, shortLabel: "RB" }, admin);
    const tagged = await makeChain(year, biz.id);
    const own = await makeChain(year, null);
    await deliver(tagged.so.id, tagged.soItemId, year);
    await deliver(own.so.id, own.soItemId, year);

    const all = await getReconciliation(admin, "all");
    expect(all.deliveredNotBilled.rows.find((r) => r.id === tagged.so.id)?.businessLabel).toBe(biz.name);
    const ownOnly = await getReconciliation(admin, "own");
    expect(ownOnly.deliveredNotBilled.rows.some((r) => r.id === own.so.id)).toBe(true);
    expect(ownOnly.deliveredNotBilled.rows.some((r) => r.id === tagged.so.id)).toBe(false);
    const taggedOnly = await getReconciliation(admin, biz.id);
    expect(taggedOnly.deliveredNotBilled.rows.some((r) => r.id === tagged.so.id)).toBe(true);
    expect(taggedOnly.deliveredNotBilled.rows.some((r) => r.id === own.so.id)).toBe(false);
  });

  it("gap reasons record, validate, show on the lists, and clear", async () => {
    const year = await freshYear();
    const chain = await makeChain(year, null);
    await markPurchaseOrderSent(chain.po.id, admin);
    await deliver(chain.so.id, chain.soItemId, year);
    await receive(chain.po.id, year);

    await setSalesOrderGapReason(chain.so.id, { code: "CUSTOMER_NO_INVOICE", note: "DR only, per buyer" }, admin);
    await setPurchaseOrderGapReason(chain.po.id, { code: "SUPPLIER_NO_INVOICE", note: null }, admin);
    const recon = await getReconciliation(admin, "all");
    expect(recon.deliveredNotBilled.rows.find((r) => r.id === chain.so.id)?.gapReason).toBe("Customer did not request an invoice");
    expect(recon.deliveredNotBilled.rows.find((r) => r.id === chain.so.id)?.gapNote).toBe("DR only, per buyer");
    expect(recon.receivedNotInvoiced.rows.find((r) => r.id === chain.po.id)?.gapReason).toBe("Supplier did not issue an invoice");

    // OTHER needs a note; unknown codes are refused; a PO code on an SO is refused.
    await expect(setSalesOrderGapReason(chain.so.id, { code: "OTHER", note: null }, admin)).rejects.toThrow(/Write the note/);
    await expect(setSalesOrderGapReason(chain.so.id, { code: "SUPPLIER_NO_INVOICE", note: null }, admin)).rejects.toThrow(/Pick a reason/);
    await expect(setPurchaseOrderGapReason(chain.po.id, { code: "NOPE", note: null }, admin)).rejects.toThrow(/Pick a reason/);

    // Clear.
    await setSalesOrderGapReason(chain.so.id, { code: null, note: null }, admin);
    const after = await db.salesOrder.findUniqueOrThrow({ where: { id: chain.so.id } });
    expect(after.gapReasonCode).toBeNull();
    expect(after.gapNote).toBeNull();
  });

  it("the reconciliation page is Admin-only at the service", async () => {
    await expect(getReconciliation(staff, "all")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("operational profit counts recorded orders per business; the official figure stays billing-based", async () => {
    const year = await freshYear();
    const biz = await saveBusiness({ name: `Ops Biz ${tag()}`, shortLabel: "OB" }, admin);
    const own = await makeChain(year, null);
    const tagged = await makeChain(year, biz.id);
    void own;
    void tagged;
    const month = `${year}-03`;
    await recordExpense(
      {
        date: new Date(Date.UTC(year, 2, 10)),
        supplierId: null,
        payeeText: `Payee ${tag()}`,
        categoryId,
        amount: "900.00",
        withholdingApplied: "0",
        cashAccountId: accountId,
        receiptNo: null,
        notes: null,
        salesOrderId: null,
        purchaseOrderId: null,
        businessId: null,
      } as Parameters<typeof recordExpense>[0],
      admin,
    );
    await recordExpense(
      {
        date: new Date(Date.UTC(year, 2, 10)),
        supplierId: null,
        payeeText: `Payee ${tag()}`,
        categoryId,
        amount: "350.00",
        withholdingApplied: "0",
        cashAccountId: accountId,
        receiptNo: null,
        notes: null,
        salesOrderId: tagged.so.id,
        purchaseOrderId: null,
        businessId: null,
      } as Parameters<typeof recordExpense>[0],
      admin,
    );

    const report = await getOperationalProfit(admin, month);
    const ownRow = report.rows.find((r) => r.businessId === null);
    expect(ownRow?.sales).toBe("10000.00");
    expect(ownRow?.supplierCosts).toBe("4000.00");
    expect(ownRow?.expenses).toBe("900.00");
    expect(ownRow?.profit).toBe("5100.00");
    const bizRow = report.rows.find((r) => r.businessId === biz.id);
    expect(bizRow?.sales).toBe("10000.00");
    expect(bizRow?.expenses).toBe("350.00");
    expect(bizRow?.profit).toBe("5650.00");
    expect(report.combined.sales).toBe("20000.00");
    expect(report.combined.profit).toBe("10750.00");
    // Nothing was billed in this month — the official figure is zero even
    // though recorded sales are 20000. The two views never mix.
    expect(report.officialBilledRevenue).toBe("0.00");
  });
});
