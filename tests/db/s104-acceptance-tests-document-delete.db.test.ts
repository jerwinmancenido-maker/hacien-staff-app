// S-104 — admin hard-delete for draft/void documents. Exercises the real
// delete service against the test DB: happy paths per document type, every
// guard, role checks at the service, series non-reuse, audit survival,
// rollback, and the no-delete exception's boundaries.
import { describe, expect, it, vi } from "vitest";

// This suite's harness points Prisma at TEST_DATABASE_URL (the name must
// contain "test"). Assertions below are unchanged.
vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
});

import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { HardDeleteError } from "@/lib/no-delete";
import { ForbiddenError } from "@/lib/permissions";
import { listBookSourceRows } from "@/lib/services/books";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import {
  deleteBilling,
  deleteCollection,
  deleteQuote,
  deleteSalesOrder,
  proveNestedDifferentModelDeleteBlocked,
  type DeleteActor,
} from "@/lib/services/document-delete";
import { createPurchaseOrdersFromSalesOrder } from "@/lib/services/purchase-orders";
import { approveQuote, convertQuoteToSalesOrder, createQuote, voidQuote, type DocActor } from "@/lib/services/quotes";
import { voidSalesOrder } from "@/lib/services/sales-orders";
import { getSettingsSnapshot } from "@/lib/settings";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

const REASON = "Entered by mistake in testing";

let admin: DocActor;
let approver: DeleteActor;
let staff: DocActor;
let viewer: DocActor;
let inactiveAdmin: DeleteActor;

async function actors() {
  if (!admin) {
    admin = await makeUser("costs");
    staff = await makeUser("staff");
    viewer = await makeUser("viewer");
    approver = (await db.user.create({
      data: { email: `approver-${tag()}@test.example.com`, name: "Approver only", isApprover: true, canSeeCosts: true },
    })) as DeleteActor;
    inactiveAdmin = (await db.user.create({
      data: { email: `inactive-admin-${tag()}@test.example.com`, name: "Inactive admin", isAdmin: true, active: false, canSeeCosts: true },
    })) as DeleteActor;
  }
  return admin;
}

async function draftQuote(year: number) {
  const customer = await makeCustomer();
  const q = await createQuote(
    {
      customerId: customer.id,
      contactId: customer.contacts[0]!.id,
      date: new Date(Date.UTC(year, 2, 1)),
      validUntil: undefined,
      terms: "Net 30",
      notes: null,
      items: [
        { id: null, description: "Goods", kind: "GOODS", qty: "2", unit: "pc", supplierId: null, supplierUnitCost: "0", unitPrice: "1000" },
      ],
    },
    admin,
  );
  return { customer, q };
}

async function ensureWideBooklet() {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet billing" };
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

let invoiceSeq = 710_000 + Math.floor(Math.random() * 50_000);
const nextInvoice = () => ++invoiceSeq;

async function openSo(year: number) {
  await ensureWideBooklet();
  const customer = await makeCustomer(["GOODS_1"]);
  const supplier = await makeSupplier();
  const rate = await db.withholdingRate.findUnique({ where: { code: "GOODS_1" } });
  if (!rate) {
    await db.withholdingRate.create({
      data: { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS", atcCode: "WC010", rate: "0.0100", sortOrder: 1 },
    });
  }
  const q = await createQuote(
    {
      customerId: customer.id,
      contactId: customer.contacts[0]!.id,
      date: new Date(Date.UTC(year, 2, 1)),
      validUntil: undefined,
      terms: "Net 30",
      notes: null,
      items: [
        {
          id: null,
          description: "Goods",
          kind: "GOODS",
          qty: "1",
          unit: "lot",
          supplierId: supplier.id,
          supplierUnitCost: "80000",
          unitPrice: "100000",
        },
      ],
    },
    admin,
  );
  await approveQuote(q.id, admin);
  const deliveryAddressId = await customerDeliveryAddressId(customer.id);
  const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-DEL", deliveryAddressId }, admin, {
    date: new Date(Date.UTC(year, 2, 2)),
  });
  return { customer, supplier, q, so };
}

describe("S-104 document delete", () => {
  it("deletes a draft quote with its items, writes the audit snapshot, and never reuses the number", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    const seriesBefore = await db.documentSeries.findUnique({ where: { docType_year: { docType: "QUOTE", year } } });

    const out = await deleteQuote(q.id, REASON, admin);
    expect(out.number).toBe(q.number);
    expect(await db.quote.findUnique({ where: { id: q.id } })).toBeNull();
    expect(await db.quoteItem.count({ where: { quoteId: q.id } })).toBe(0);

    const audit = await db.auditLog.findFirst({ where: { entityType: "Quote", entityId: q.id, action: "delete" } });
    expect(audit).not.toBeNull();
    const snap = audit!.before as { number?: string; reason?: string; customer?: string; total?: string };
    expect(snap.number).toBe(q.number);
    expect(snap.reason).toBe(REASON);
    expect(snap.customer).toBeTruthy();

    const seriesAfter = await db.documentSeries.findUnique({ where: { docType_year: { docType: "QUOTE", year } } });
    expect(seriesAfter?.nextNumber).toBe(seriesBefore?.nextNumber);

    // A fresh quote in the same year gets a different, later number.
    const { q: q2 } = await draftQuote(year);
    expect(q2.number).not.toBe(q.number);
  });

  it("deletes a void quote, and its DocumentVoid row survives", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    await voidQuote(q.id, "No longer needed", admin);
    await deleteQuote(q.id, REASON, admin);
    expect(await db.quote.findUnique({ where: { id: q.id } })).toBeNull();
    const voids = await db.documentVoid.findMany({ where: { docType: "QUOTE", docId: q.id } });
    expect(voids.length).toBeGreaterThan(0);
  });

  it("refuses a quote that has any sales order, even a void one (CTO rule)", async () => {
    await actors();
    const year = await freshYear();
    const { q, so } = await openSo(year);
    await voidSalesOrder(so.id, "Order cancelled", admin);
    await voidQuote(q.id, "Quote superseded", admin);
    await expect(deleteQuote(q.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.quote.findUnique({ where: { id: q.id } })).not.toBeNull();
  });

  it("refuses a draft quote with an attachment — archived attachments count too", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    await db.documentAttachment.create({
      data: {
        quoteId: q.id,
        fileName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 123,
        sha256: "0".repeat(64),
        storageKey: `test-${tag()}`,
        uploadedById: admin.id,
        archivedAt: new Date(),
      },
    });
    await expect(deleteQuote(q.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.quote.findUnique({ where: { id: q.id } })).not.toBeNull();
  });

  it("deletes a lot quote's components with the line", async () => {
    await actors();
    const year = await freshYear();
    const customer = await makeCustomer();
    const sup = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          {
            id: null,
            description: "Bundle",
            kind: "SERVICES",
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "600000",
            isLot: true,
            components: [
              { id: null, itemId: null, description: "Part A", qty: "1", unit: "lot", supplierId: sup.id, unitCost: "300000" },
              { id: null, itemId: null, description: "Part B", qty: "2", unit: "hour", supplierId: sup.id, unitCost: "50000" },
            ],
          },
        ],
      },
      admin,
    );
    const item = await db.quoteItem.findFirstOrThrow({ where: { quoteId: q.id } });
    expect(await db.quoteItemComponent.count({ where: { quoteItemId: item.id } })).toBe(2);
    await deleteQuote(q.id, REASON, admin);
    expect(await db.quoteItemComponent.count({ where: { quoteItemId: item.id } })).toBe(0);
    expect(await db.quoteItem.count({ where: { quoteId: q.id } })).toBe(0);
  });

  it("marks the document's open reminders done in the same delete", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    const rem = await db.reminder.create({
      data: { entityType: "QUOTE", entityId: q.id, note: "Follow up", remindAt: new Date(Date.UTC(year, 3, 1)), createdById: admin.id },
    });
    await deleteQuote(q.id, REASON, admin);
    const after = await db.reminder.findUnique({ where: { id: rem.id } });
    expect(after?.doneAt).not.toBeNull();
  });

  it("refuses non-admin roles and an inactive admin at the service", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    await expect(deleteQuote(q.id, REASON, approver)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteQuote(q.id, REASON, staff as DeleteActor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteQuote(q.id, REASON, viewer as DeleteActor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteQuote(q.id, REASON, inactiveAdmin)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.quote.findUnique({ where: { id: q.id } })).not.toBeNull();
  });

  it("requires a real reason", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    await expect(deleteQuote(q.id, "ab", admin)).rejects.toBeInstanceOf(DocRuleError);
    await expect(deleteQuote(q.id, "   ", admin)).rejects.toBeInstanceOf(DocRuleError);
  });

  it("rolls everything back when a write fails mid-transaction", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    // An admin-shaped actor whose id does not exist: the audit write hits
    // its FK and the whole delete must roll back (surfacing as a refusal).
    const ghost = { ...admin, id: `ghost-${tag()}` } as DeleteActor;
    await expect(deleteQuote(q.id, REASON, ghost)).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.quote.findUnique({ where: { id: q.id } })).not.toBeNull();
    expect(await db.quoteItem.count({ where: { quoteId: q.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: q.id, action: "delete" } })).toBe(0);
  });
});

describe("S-104 sales order / billing / collection deletes", () => {
  it("deletes a void sales order with its items and components", async () => {
    await actors();
    const year = await freshYear();
    const { so } = await openSo(year);
    await voidSalesOrder(so.id, "Order cancelled", admin);
    const out = await deleteSalesOrder(so.id, REASON, admin);
    expect(out.number).toBe(so.number);
    expect(await db.salesOrder.findUnique({ where: { id: so.id } })).toBeNull();
    expect(await db.salesOrderItem.count({ where: { salesOrderId: so.id } })).toBe(0);
    const audit = await db.auditLog.findFirst({ where: { entityType: "SalesOrder", entityId: so.id, action: "delete" } });
    expect(audit).not.toBeNull();
  });

  it("refuses an OPEN sales order and one with purchase orders", async () => {
    await actors();
    const year = await freshYear();
    const { so } = await openSo(year);
    await expect(deleteSalesOrder(so.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
    await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: "Test address", supplierPicks: {}, lineIds: undefined, excludeComponentIds: undefined },
      admin,
    );
    await voidSalesOrder(so.id, "Order cancelled", admin);
    await expect(deleteSalesOrder(so.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.salesOrder.findUnique({ where: { id: so.id } })).not.toBeNull();
  });

  it("refuses a sales order with billings and points at the billing first", async () => {
    await actors();
    const year = await freshYear();
    const { so } = await openSo(year);
    await recordBilling(
      { salesOrderId: so.id, amount: "10000.00", invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null, invoiceNo: nextInvoice() },
      admin,
    );
    await voidSalesOrder(so.id, "Order cancelled", admin);
    await expect(deleteSalesOrder(so.id, REASON, admin)).rejects.toThrow(/Delete the billing first/);
  });

  it("deletes a clean void billing; its SI stays in the Books source rows as Deleted (void)", async () => {
    await actors();
    const year = await freshYear();
    const { so } = await openSo(year);
    const billing = await recordBilling(
      { salesOrderId: so.id, amount: "10000.00", invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null, invoiceNo: nextInvoice() },
      admin,
    );
    await voidBilling(billing.id, "Wrong amount", admin);
    const out = await deleteBilling(billing.id, REASON, admin);
    expect(out.number).toBe(billing.number);
    expect(await db.billing.findUnique({ where: { id: billing.id } })).toBeNull();
    // The void record survives (DocumentVoid has no FK to the billing)…
    expect(await db.documentVoid.count({ where: { docType: "BILLING", docId: billing.id } })).toBe(1);
    // …and the Books source rows still account for the SI number.
    const rows = await listBookSourceRows(admin);
    const row = rows.find((r) => r.id === `deleted-${billing.id}`);
    expect(row?.documentNumber).toBe(`INV-${billing.invoiceNo}`);
    expect(row?.particulars).toBe(`Deleted (void), SI no. INV-${billing.invoiceNo}`);
    expect(row?.voided).toBe(true);
    expect(row?.href).toBeNull();
  });

  it("refuses a void billing whose allocations came from a void collection (CTO rule)", async () => {
    await actors();
    const year = await freshYear();
    const { customer, so } = await openSo(year);
    const billing = await recordBilling(
      { salesOrderId: so.id, amount: "10000.00", invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null, invoiceNo: nextInvoice() },
      admin,
    );
    const collection = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "BANK_TRANSFER",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "9900.00",
        notes: null,
        allocations: [{ billingId: billing.id, cashApplied: "9900.00", withholdingApplied: "100.00", withholdingRate: "0.0100", atcCode: "WC010" }],
      },
      admin,
    );
    // Voiding the collection KEEPS its allocation rows — and those rows
    // must still block the billing delete afterwards.
    await voidCollection(collection.id, "Wrong entry", admin);
    expect(await db.collectionAllocation.count({ where: { billingId: billing.id } })).toBe(1);
    await voidBilling(billing.id, "Wrong amount", admin);
    await expect(deleteBilling(billing.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.billing.findUnique({ where: { id: billing.id } })).not.toBeNull();
    // The collection itself is also undeletable: it allocated money.
    await expect(deleteCollection(collection.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
  });

  it("refuses a void billing with a credit application", async () => {
    await actors();
    const year = await freshYear();
    const { customer, so } = await openSo(year);
    const billing = await recordBilling(
      { salesOrderId: so.id, amount: "10000.00", invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null, invoiceNo: nextInvoice() },
      admin,
    );
    await voidBilling(billing.id, "Wrong amount", admin);
    // voidBilling refuses while a credit application exists, so this state
    // is legacy/defensive — build the application chain directly to prove
    // the delete guard holds if such a row is ever present.
    const ret = await db.customerReturn.create({
      data: { number: `RET-DEL-${tag()}`, salesOrderId: so.id, returnDate: new Date(Date.UTC(year, 2, 7)), createdById: admin.id },
    });
    const credit = await db.customerCredit.create({
      data: { customerId: customer.id, customerReturnId: ret.id, amount: "500.00", createdById: admin.id },
    });
    await db.customerCreditApplication.create({ data: { customerCreditId: credit.id, billingId: billing.id, cashApplied: "500.00" } });
    await expect(deleteBilling(billing.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.billing.findUnique({ where: { id: billing.id } })).not.toBeNull();
  });

  it("refuses a void collection that carries an official receipt number", async () => {
    await actors();
    const year = await freshYear();
    const { customer, so } = await openSo(year);
    const billing = await recordBilling(
      { salesOrderId: so.id, amount: "10000.00", invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null, invoiceNo: nextInvoice() },
      admin,
    );
    const collection = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "BANK_TRANSFER",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: `OR-DEL-${year}`,
        amountReceived: "9900.00",
        notes: null,
        allocations: [{ billingId: billing.id, cashApplied: "9900.00", withholdingApplied: "100.00", withholdingRate: "0.0100", atcCode: "WC010" }],
      },
      admin,
    );
    await voidCollection(collection.id, "Wrong entry", admin);
    await expect(deleteCollection(collection.id, REASON, admin)).rejects.toBeInstanceOf(DocRuleError);
    expect(await db.collection.findUnique({ where: { id: collection.id } })).not.toBeNull();
  });

  it("deletes a clean void collection (no receipt number, no allocations)", async () => {
    await actors();
    const year = await freshYear();
    const customer = await makeCustomer();
    const c = await db.collection.create({
      data: {
        number: `CR-DEL-${tag()}`,
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "CASH",
        amountReceived: "100.00",
        status: "VOID",
        voidReason: "Wrong entry",
        createdById: admin.id,
      },
    });
    const out = await deleteCollection(c.id, REASON, admin);
    expect(out.number).toBe(c.number);
    expect(await db.collection.findUnique({ where: { id: c.id } })).toBeNull();
    const audit = await db.auditLog.findFirst({ where: { entityType: "Collection", entityId: c.id, action: "delete" } });
    expect((audit!.before as { total?: string }).total).toBe("100.00");
  });
});

describe("S-104 no-delete exception boundaries", () => {
  it("a delete inside a transaction but OUTSIDE the allowance still throws", async () => {
    await actors();
    const year = await freshYear();
    const { q } = await draftQuote(year);
    await expect(
      db.$transaction(async (tx) => {
        await tx.quote.delete({ where: { id: q.id } });
      }),
    ).rejects.toBeInstanceOf(HardDeleteError);
    expect(await db.quote.findUnique({ where: { id: q.id } })).not.toBeNull();
  });

  it("the allowance does not leak to a different model (nested different-model delete throws)", async () => {
    await actors();
    // Exercised through the delete service's own probe: the allowance can
    // no longer be imported directly (it is keyed by a non-exported
    // symbol), so the service proves the boundary itself.
    const probe = await proveNestedDifferentModelDeleteBlocked();
    expect(probe.quoteAllowedInside).toBe(true);
    expect(probe.otherBlockedInside).toBe(true);
    expect(probe.nestedOtherBlocked).toBe(true);
  });
});
