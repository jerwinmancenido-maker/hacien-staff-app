// Business entities (Reconciliation Plan 2026-11-19, PR-A): the Settings
// catalogue, the Admin/Approver-only tagging rule, Quote → SO → PO/Expense
// flow-through, the billing block on another business's order, and the
// Admin reclassify. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import {
  BusinessRuleError,
  listBusinesses,
  reclassifySalesOrderBusiness,
  saveBusiness,
  setBusinessActive,
} from "@/lib/services/businesses";
import { recordBilling } from "@/lib/services/billings";
import { createCashAccount, type CashActor } from "@/lib/services/cash-accounts";
import { recordExpense } from "@/lib/services/expenses";
import { createPurchaseOrdersFromSalesOrder, createStandalonePurchaseOrder } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("business entities (MySQL)", () => {
  let admin: DocActor & CashActor;
  let staff: DocActor;
  let categoryId: string;
  let accountId: string;
  let invoiceSeq = 800_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-business-uploads-"));
    process.env.CASH_ENABLED = "true";
    admin = await makeUser("costs");
    staff = await makeUser("staff");
    const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!cat) throw new Error("ExpenseCategory seed missing — run migrations on TEST_DATABASE_URL.");
    categoryId = cat.id;
    const year = await freshYear();
    const account = await createCashAccount(
      {
        name: `BizAcct-${tag()}`,
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
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Same pattern as billing.db.test.ts: other suites can republish settings
   * with the default 1–500 booklet, which would reject this suite's invoice
   * numbers before the business block is even reached. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet business" };
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

  async function makeBusiness(name = `Other Biz ${tag()}`) {
    return saveBusiness({ name, shortLabel: "OB" }, admin);
  }

  /** Quote (optionally tagged) → approved → converted SO. Returns both rows. */
  async function makeSo(year: number, businessId: string | null, actor: DocActor = admin) {
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
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: supplier.id, supplierUnitCost: "4000", unitPrice: "5000" },
        ],
      },
      actor,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: `B-BIZ-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    return { customer, supplier, quote: q, so };
  }

  async function makePoForSo(year: number, soId: string, supplierId: string) {
    const items = await db.salesOrderItem.findMany({ where: { salesOrderId: soId, removedAt: null }, orderBy: { sortOrder: "asc" } });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      soId,
      {
        date: new Date(Date.UTC(year, 2, 3)),
        expectedDate: null,
        deliveryAddressText: null,
        supplierPicks: {},
        idempotencyKey: `biz-${year}-${tag()}`.slice(0, 64),
        rows: [{ key: items[0]!.id, supplierId, qty: "1" }],
      },
      admin,
    );
    return po!;
  }

  it("catalogue: admin adds a business; duplicate names and staff writes are refused; switch off/on keeps the row", async () => {
    const biz = await makeBusiness();
    expect(biz.active).toBe(true);
    await expect(saveBusiness({ name: biz.name, shortLabel: "XX" }, admin)).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(saveBusiness({ name: `Nope ${tag()}`, shortLabel: "NO" }, staff as never)).rejects.toBeInstanceOf(ForbiddenError);
    await setBusinessActive(biz.id, false, admin);
    const off = await db.business.findUnique({ where: { id: biz.id } });
    expect(off?.active).toBe(false);
    expect((await listBusinesses({ activeOnly: true })).some((b) => b.id === biz.id)).toBe(false);
    expect((await listBusinesses()).some((b) => b.id === biz.id)).toBe(true);
    await setBusinessActive(biz.id, true, admin);
  });

  it("tagging: staff cannot tag a quote; a switched-off or missing business is refused", async () => {
    const year = await freshYear();
    const biz = await makeBusiness();
    const customer = await makeCustomer();
    const base = {
      customerId: customer.id,
      contactId: customer.contacts[0]!.id,
      date: new Date(Date.UTC(year, 2, 1)),
      validUntil: undefined,
      terms: "Net 30",
      notes: null,
      items: [{ id: null, description: "Goods", kind: "GOODS" as const, qty: "1", unit: "lot", supplierId: null, supplierUnitCost: "100", unitPrice: "1000" }],
    };
    await expect(createQuote({ ...base, businessId: biz.id }, staff)).rejects.toMatchObject({
      message: expect.stringMatching(/Only an Admin or Approver/),
    });
    await expect(createQuote({ ...base, businessId: "missing-id" }, admin)).rejects.toMatchObject({
      message: expect.stringMatching(/no longer exists/),
    });
    await setBusinessActive(biz.id, false, admin);
    await expect(createQuote({ ...base, businessId: biz.id }, admin)).rejects.toMatchObject({
      message: expect.stringMatching(/switched off/),
    });
    await setBusinessActive(biz.id, true, admin);
  });

  it("flow-through: quote tag lands on the SO and its POs; billing is blocked on the tagged SO only", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    const biz = await makeBusiness();
    const { supplier, so } = await makeSo(year, biz.id);
    expect(so.businessId).toBe(biz.id);
    const po = await makePoForSo(year, so.id, supplier.id);
    expect(po.businessId).toBe(biz.id);

    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "1000.00",
          invoiceNo: nextInvoice(),
          invoiceDate: new Date(Date.UTC(year, 2, 5)),
          dueDate: new Date(Date.UTC(year, 3, 4)),
          notes: null,
        },
        admin,
      ),
    ).rejects.toMatchObject({ message: expect.stringMatching(/issued by/) });

    const own = await makeSo(year, null);
    const billing = await recordBilling(
      {
        salesOrderId: own.so.id,
        amount: "1000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    expect(billing.salesOrderId).toBe(own.so.id);
  });

  it("standalone PO: admin tags it; staff is refused", async () => {
    const year = await freshYear();
    const biz = await makeBusiness();
    const supplier = await makeSupplier();
    const input = {
      supplierId: supplier.id,
      supplierContactId: null,
      date: new Date(Date.UTC(year, 2, 1)),
      expectedDate: null,
      terms: "Net 30",
      deliveryAddressText: null,
      supplierAddressText: null,
      notes: null,
      items: [{ id: null, description: "Goods", kind: "GOODS" as const, qty: "1", unit: "lot", unitCost: "1000.00" }],
    };
    const po = await createStandalonePurchaseOrder({ ...input, businessId: biz.id }, admin);
    expect(po.businessId).toBe(biz.id);
    // Staff are refused even earlier — standalone PO creation itself is
    // Admin-gated in the service (ForbiddenError before the tagging rule).
    await expect(createStandalonePurchaseOrder({ ...input, businessId: biz.id }, staff as never)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("expenses: a linked expense inherits its order's business; an unlinked one takes the validated pick", async () => {
    const year = await freshYear();
    const biz = await makeBusiness();
    const { so } = await makeSo(year, biz.id);
    const base = {
      date: new Date(Date.UTC(year, 2, 10)),
      supplierId: null,
      payeeText: `Payee ${tag()}`,
      categoryId,
      amount: "350.00",
      withholdingApplied: "0",
      cashAccountId: accountId,
      receiptNo: null,
      notes: null,
    } as Parameters<typeof recordExpense>[0];

    const linked = await recordExpense({ ...base, salesOrderId: so.id, purchaseOrderId: null, businessId: null }, admin);
    expect(linked.businessId).toBe(biz.id);

    const unlinked = await recordExpense({ ...base, salesOrderId: null, purchaseOrderId: null, businessId: biz.id }, admin);
    expect(unlinked.businessId).toBe(biz.id);

    const own = await recordExpense({ ...base, salesOrderId: null, purchaseOrderId: null, businessId: null }, admin);
    expect(own.businessId).toBeNull();
  });

  it("reclassify: Admin moves SO + POs + linked expenses together, audited; staff and billed orders are refused", async () => {
    await ensureWideBooklet();
    const year = await freshYear();
    const biz = await makeBusiness();
    const { supplier, so } = await makeSo(year, null);
    const po = await makePoForSo(year, so.id, supplier.id);
    const expense = await recordExpense(
      {
        date: new Date(Date.UTC(year, 2, 10)),
        supplierId: null,
        payeeText: `Payee ${tag()}`,
        categoryId,
        amount: "100.00",
        withholdingApplied: "0",
        cashAccountId: accountId,
        receiptNo: null,
        notes: null,
        salesOrderId: so.id,
        purchaseOrderId: null,
        businessId: null,
      } as Parameters<typeof recordExpense>[0],
      admin,
    );
    expect(expense.businessId).toBeNull();

    await expect(reclassifySalesOrderBusiness(so.id, biz.id, staff as never)).rejects.toMatchObject({
      message: expect.stringMatching(/Only an Admin/),
    });

    await reclassifySalesOrderBusiness(so.id, biz.id, admin);
    expect((await db.salesOrder.findUnique({ where: { id: so.id } }))?.businessId).toBe(biz.id);
    expect((await db.purchaseOrder.findUnique({ where: { id: po.id } }))?.businessId).toBe(biz.id);
    expect((await db.expense.findUnique({ where: { id: expense.id } }))?.businessId).toBe(biz.id);
    const audit = await db.auditLog.findFirst({
      where: { entityType: "SalesOrder", entityId: so.id },
      orderBy: { at: "desc" },
    });
    expect(JSON.stringify(audit?.after ?? {})).toContain(biz.name);

    // Back to the own company, then bill it — after that, reclassify refuses.
    await reclassifySalesOrderBusiness(so.id, null, admin);
    expect((await db.salesOrder.findUnique({ where: { id: so.id } }))?.businessId).toBeNull();
    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "1000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    await expect(reclassifySalesOrderBusiness(so.id, biz.id, admin)).rejects.toMatchObject({
      message: expect.stringMatching(/already has billing/),
    });
  });
});
