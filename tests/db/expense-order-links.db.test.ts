// Phase 4 #7 (re-planned): expense order links — service persist +
// pair validation (X4 / X5) and Cost & margin halves (X1–X3 / X5)
// against MySQL 8 (TEST_DATABASE_URL). Requires CASH_ENABLED.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  process.env.CASH_ENABLED = "true";
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { createCashAccount, type CashActor } from "@/lib/services/cash-accounts";
import { getExpense, recordExpense, voidExpense } from "@/lib/services/expenses";
import { getSoCostMargin } from "@/lib/purchasing/views";
import { createPurchaseOrdersFromSalesOrder, createStandalonePurchaseOrder } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("expense order links (MySQL)", () => {
  let admin: CashActor & DocActor;
  let categoryId: string;
  let accountId: string;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-expense-link-uploads-"));
    process.env.CASH_ENABLED = "true";
    admin = await makeUser("costs");
    const cat = await db.expenseCategory.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!cat) throw new Error("ExpenseCategory seed missing — run migrations on TEST_DATABASE_URL.");
    categoryId = cat.id;
    const year = await freshYear();
    const account = await createCashAccount(
      {
        name: `LinkAcct-${tag()}`,
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
    process.env.CASH_ENABLED = "true";
    await db.$disconnect();
  });

  async function makeSo(year: number) {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: supplier.id, supplierUnitCost: "4000", unitPrice: "5000" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-LINK", deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    return { customer, supplier, so };
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
        idempotencyKey: `link-${year}-${tag()}`.slice(0, 64),
        rows: [{ key: items[0]!.id, supplierId, qty: "1" }],
      },
      admin,
    );
    return po!;
  }

  async function makeStandalonePo(year: number) {
    const supplier = await makeSupplier();
    return createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 1)),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", unitCost: "1000.00" }],
      },
      admin,
    );
  }

  function expenseInput(year: number, extra: Record<string, unknown> = {}) {
    return {
      date: new Date(Date.UTC(year, 2, 10)),
      supplierId: null,
      payeeText: `Lalamove ${tag()}`,
      categoryId,
      amount: "350.00",
      withholdingApplied: "0",
      cashAccountId: accountId,
      receiptNo: null,
      notes: null,
      ...extra,
    } as Parameters<typeof recordExpense>[0];
  }

  it("X1 persist: SO-only link is stored, returned by getExpense, and audited with the SO number", async () => {
    const year = await freshYear();
    const { so } = await makeSo(year);
    const exp = await recordExpense(expenseInput(year, { salesOrderId: so.id }), admin);
    expect(exp.salesOrderId).toBe(so.id);
    expect(exp.purchaseOrderId).toBeNull();

    const got = await getExpense(exp.id);
    expect(got?.salesOrder?.number).toBe(so.number);
    expect(got?.purchaseOrder).toBeNull();

    const audit = await db.auditLog.findFirst({ where: { entityType: "Expense", entityId: exp.id, action: "create" } });
    expect(JSON.stringify(audit?.after ?? {})).toContain(so.number);
  });

  it("X2 persist: PO-only link on a standalone PO is stored and returned", async () => {
    const year = await freshYear();
    const po = await makeStandalonePo(year);
    const exp = await recordExpense(expenseInput(year, { purchaseOrderId: po.id }), admin);
    expect(exp.purchaseOrderId).toBe(po.id);
    expect(exp.salesOrderId).toBeNull();
    const got = await getExpense(exp.id);
    expect(got?.purchaseOrder?.number).toBe(po.number);
    expect(got?.salesOrder).toBeNull();
  });

  it("X3 persist: both links on the same SO/PO pair are stored together", async () => {
    const year = await freshYear();
    const { supplier, so } = await makeSo(year);
    const po = await makePoForSo(year, so.id, supplier.id);
    const exp = await recordExpense(expenseInput(year, { salesOrderId: so.id, purchaseOrderId: po.id }), admin);
    expect(exp.salesOrderId).toBe(so.id);
    expect(exp.purchaseOrderId).toBe(po.id);
  });

  it("unlinked expense still records exactly as before (null links)", async () => {
    const year = await freshYear();
    const exp = await recordExpense(expenseInput(year), admin);
    expect(exp.salesOrderId).toBeNull();
    expect(exp.purchaseOrderId).toBeNull();
    expect(exp.status).toBe("POSTED");
  });

  it("X4: a PO belonging to a different SO is refused and nothing is saved", async () => {
    const year = await freshYear();
    const a = await makeSo(year);
    const b = await makeSo(year);
    const poOfA = await makePoForSo(year, a.so.id, a.supplier.id);
    const payee = `BadPair ${tag()}`;
    await expect(
      recordExpense(expenseInput(year, { payeeText: payee, salesOrderId: b.so.id, purchaseOrderId: poOfA.id }), admin),
    ).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.expense.count({ where: { payeeText: payee } })).toBe(0);
  });

  it("X4: missing or VOID linked orders are refused by the service", async () => {
    const year = await freshYear();
    await expect(recordExpense(expenseInput(year, { salesOrderId: `missing-${tag()}` }), admin)).rejects.toThrow(/sales order was not found/i);
    await expect(recordExpense(expenseInput(year, { purchaseOrderId: `missing-${tag()}` }), admin)).rejects.toThrow(/purchase order was not found/i);

    const { so } = await makeSo(year);
    await db.salesOrder.update({ where: { id: so.id }, data: { status: "VOID" } });
    await expect(recordExpense(expenseInput(year, { salesOrderId: so.id }), admin)).rejects.toThrow(/void/i);

    const po = await makeStandalonePo(year);
    await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "VOID" } });
    await expect(recordExpense(expenseInput(year, { purchaseOrderId: po.id }), admin)).rejects.toThrow(/void/i);
  });

  it("X5 persist half: voiding a linked expense flips it to VOID (margin half lands in step 3)", async () => {
    const year = await freshYear();
    const { so } = await makeSo(year);
    const exp = await recordExpense(expenseInput(year, { salesOrderId: so.id }), admin);
    await voidExpense(exp.id, "Wrong order linked — reverse", admin);
    const after = await db.expense.findUniqueOrThrow({ where: { id: exp.id } });
    expect(after.status).toBe("VOID");
    expect(after.salesOrderId).toBe(so.id);
  });

  // Cost & margin halves (step 3). Fixture SO: contract 5000, planned
  // supplier cost 4000, no bills/receipts — so PO incurred starts at 0.
  it("X1 margin: SO-only linked expense raises Cost so far and lowers margins, planned unchanged", async () => {
    const year = await freshYear();
    const { so } = await makeSo(year);
    const before = await getSoCostMargin(so.id, admin);
    expect(before?.linkedExpenses).toBe("0.00");
    expect(before?.incurredCost).toBe("0.00");
    expect(before?.costState).toBe("none");
    await recordExpense(expenseInput(year, { salesOrderId: so.id }), admin);
    const after = await getSoCostMargin(so.id, admin);
    expect(after?.linkedExpenses).toBe("350.00");
    expect(after?.incurredCost).toBe("350.00");
    expect(after?.costState).toBe("partial");
    expect(after?.marginLabel).toBe("Margin so far");
    expect(after?.actual.margin).toBe("4650.00");
    expect(after?.afterWithholding.margin).toBe("4650.00");
    expect(after?.planned.margin).toBe(before?.planned.margin);
  });

  it("X2 margin: PO-only link reaches that PO's SO; standalone PO touches no SO", async () => {
    const year = await freshYear();
    const { supplier, so } = await makeSo(year);
    const po = await makePoForSo(year, so.id, supplier.id);
    await recordExpense(expenseInput(year, { purchaseOrderId: po.id }), admin);
    const margin = await getSoCostMargin(so.id, admin);
    expect(margin?.linkedExpenses).toBe("350.00");
    expect(margin?.incurredCost).toBe("350.00");

    const other = await makeSo(year);
    const standalone = await makeStandalonePo(year);
    await recordExpense(expenseInput(year, { purchaseOrderId: standalone.id }), admin);
    const otherMargin = await getSoCostMargin(other.so.id, admin);
    expect(otherMargin?.linkedExpenses).toBe("0.00");
    expect(otherMargin?.incurredCost).toBe("0.00");
  });

  it("X3 margin: an expense linked to both the SO and its PO counts ONCE", async () => {
    const year = await freshYear();
    const { supplier, so } = await makeSo(year);
    const po = await makePoForSo(year, so.id, supplier.id);
    await recordExpense(expenseInput(year, { salesOrderId: so.id, purchaseOrderId: po.id }), admin);
    const margin = await getSoCostMargin(so.id, admin);
    expect(margin?.linkedExpenses).toBe("350.00");
    expect(margin?.incurredCost).toBe("350.00");
  });

  it("X5 margin: voiding the linked expense restores the margin; unlinked expense changes nothing", async () => {
    const year = await freshYear();
    const { so } = await makeSo(year);
    await recordExpense(expenseInput(year), admin);
    const unlinked = await getSoCostMargin(so.id, admin);
    expect(unlinked?.linkedExpenses).toBe("0.00");
    const exp = await recordExpense(expenseInput(year, { salesOrderId: so.id }), admin);
    expect((await getSoCostMargin(so.id, admin))?.incurredCost).toBe("350.00");
    await voidExpense(exp.id, "Wrong order linked — reverse", admin);
    const restored = await getSoCostMargin(so.id, admin);
    expect(restored?.linkedExpenses).toBe("0.00");
    expect(restored?.incurredCost).toBe("0.00");
    expect(restored?.costState).toBe("none");
  });
});
