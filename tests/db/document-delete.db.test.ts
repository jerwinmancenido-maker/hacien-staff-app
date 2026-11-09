// Admin delete of draft/void documents. Imports the real service.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return {
    hasDb: !!url,
    user: null as null | {
      id: string;
      active: boolean;
      isAdmin: boolean;
      isApprover: boolean;
      isStaff: boolean;
      isViewer: boolean;
      canSeeCosts: boolean;
    },
  };
});

vi.mock("@/lib/auth/current-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current-user")>();
  return { ...actual, getCurrentUser: async () => env.user };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { db } from "@/lib/db";
import { HardDeleteError } from "@/lib/no-delete";
import { ForbiddenError } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { DocRuleError } from "@/lib/documents/common";
import { auditRecordLink, auditSentence } from "@/lib/audit-log";
import { listRecentHomeActivity } from "@/lib/home/activity";
import { approveQuote, convertQuoteToSalesOrder, createQuote, voidQuote, type DocActor } from "@/lib/services/quotes";
import { voidSalesOrder } from "@/lib/services/sales-orders";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import { getBookRegister, listBookSourceRows } from "@/lib/services/books";
import { createReminder } from "@/lib/services/reminders";
import {
  armDocumentDeleteFailure,
  deleteBilling,
  deleteCollection,
  deleteQuote,
  deleteSalesOrder,
} from "@/lib/services/document-delete";
import { deleteBillingAction, deleteCollectionAction } from "@/app/(app)/billing/actions";
import { deleteQuoteAction } from "@/app/(app)/quotes/actions";
import { deleteSalesOrderAction } from "@/app/(app)/sales-orders/actions";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

const REASON = "Entered in error";

describe.skipIf(!env.hasDb)("admin delete of draft and void documents", () => {
  let admin: DocActor;
  let approver: DocActor;
  let staff: DocActor;
  let viewer: DocActor;
  let inactive: DocActor;
  let invoiceSeq = 860_000 + Math.floor(Math.random() * 20_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    const t = tag();
    approver = await db.user.create({
      data: { email: `approver-del-${t}@test.example.com`, name: `Approver ${t}`, isApprover: true, canSeeCosts: true },
    });
    inactive = await db.user.create({
      data: { email: `inactive-del-${t}@test.example.com`, name: `Inactive ${t}`, isAdmin: true, active: false, canSeeCosts: true },
    });
    await ensureWideBooklet();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Delete test booklet" };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.invoiceBooklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1 + attempt,
            data: { ...(latest.data as object), invoiceBooklet: wide } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: wide,
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // version race
      }
    }
  }

  async function draftQuote(year: number) {
    const customer = await makeCustomer();
    const quote = await createQuote(quoteInput(customer.id, year), admin);
    return { customer, quote };
  }

  async function voidedSo(year: number) {
    await ensureWideBooklet();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const quote = await createQuote(quoteInput(customer.id, year, {}, supplier.id), admin);
    await approveQuote(quote.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(
      quote.id,
      { buyerPoNo: `B-${tag()}`, deliveryAddressId },
      admin,
      { date: new Date(Date.UTC(year, 2, 2)) },
    );
    await voidSalesOrder(so.id, REASON, admin);
    return { customer, supplier, quote, so };
  }

  async function openThenBill(year: number, invoiceNo: number) {
    await ensureWideBooklet();
    const customer = await makeCustomer();
    const quote = await createQuote(quoteInput(customer.id, year), admin);
    await approveQuote(quote.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(
      quote.id,
      { buyerPoNo: `B-${tag()}`, deliveryAddressId },
      admin,
      { date: new Date(Date.UTC(year, 2, 2)) },
    );
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "10000.00",
        invoiceNo,
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    return { customer, quote, so, billing };
  }

  function asActor(user: DocActor) {
    env.user = {
      id: user.id,
      active: user.active,
      isAdmin: user.isAdmin,
      isApprover: user.isApprover,
      isStaff: user.isStaff,
      isViewer: user.isViewer,
      canSeeCosts: user.canSeeCosts,
    };
  }

  it("refuses Approver, Staff, Viewer, and an inactive Admin at the action and the service", async () => {
    const year = await freshYear();
    const { quote } = await draftQuote(year);
    const outsiders = [approver, staff, viewer, inactive];
    for (const actor of outsiders) {
      await expect(deleteQuote(quote.id, REASON, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteSalesOrder("missing", REASON, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteBilling("missing", REASON, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteCollection("missing", REASON, actor)).rejects.toBeInstanceOf(ForbiddenError);
      asActor(actor);
      const quoteRes = await deleteQuoteAction(quote.id, REASON);
      const soRes = await deleteSalesOrderAction("missing", REASON);
      const billingRes = await deleteBillingAction("missing", REASON);
      const collectionRes = await deleteCollectionAction("missing", REASON);
      for (const res of [quoteRes, soRes, billingRes, collectionRes]) {
        expect(res.ok).toBeFalsy();
        expect(res.message).toMatch(/permission/i);
      }
    }
    expect(await db.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();
  });

  it("refuses a missing or blank reason", async () => {
    const year = await freshYear();
    const { quote } = await draftQuote(year);
    await expect(deleteQuote(quote.id, "  ", admin)).rejects.toBeInstanceOf(DocRuleError);
    await expect(deleteQuote(quote.id, "no", admin)).rejects.toBeInstanceOf(DocRuleError);
    asActor(admin);
    const res = await deleteQuoteAction(quote.id, "x");
    expect(res.fieldErrors?.reason).toBeTruthy();
    expect(await db.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();
  });

  it("deletes a draft quote, keeps the series, and marks reminders done", async () => {
    const year = await freshYear();
    const first = await draftQuote(year);
    const second = await draftQuote(year);
    const item = await db.quoteItem.findFirstOrThrow({ where: { quoteId: second.quote.id } });
    await db.quoteItemComponent.create({
      data: { quoteItemId: item.id, sortOrder: 0, description: "part", qty: "1", unit: "pc", unitCost: "1" },
    });
    await db.quoteItem.update({ where: { id: item.id }, data: { removedAt: new Date() } });
    const reminder = await createReminder(admin.id, {
      entityType: "QUOTE",
      entityId: second.quote.id,
      remindAt: `${year}-04-01`,
      note: "Follow up",
    });
    const before = await db.documentSeries.findUniqueOrThrow({ where: { docType_year: { docType: "QUOTE", year } } });
    await deleteQuote(second.quote.id, REASON, admin);
    const after = await db.documentSeries.findUniqueOrThrow({ where: { docType_year: { docType: "QUOTE", year } } });
    expect(after.nextNumber).toBe(before.nextNumber);
    expect(await db.quote.findUnique({ where: { id: second.quote.id } })).toBeNull();
    expect(await db.quoteItem.count({ where: { quoteId: second.quote.id } })).toBe(0);
    expect(await db.quoteItemComponent.count({ where: { quoteItemId: item.id } })).toBe(0);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).doneAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Quote", entityId: second.quote.id, action: "delete" },
    });
    expect(audit.userId).toBe(admin.id);
    const snap = audit.before as { number: string; reason: string; customer: string; status: string };
    expect(snap.number).toBe(second.quote.number);
    expect(snap.reason).toBe(REASON);
    expect(snap.customer).toBe(second.customer.name);
    expect(snap.status).toBe("DRAFT");
    expect(auditSentence({ ...audit, before: audit.before, after: audit.after }, snap.number, admin)).toMatch(/^Deleted/);
    expect(auditRecordLink("Quote", second.quote.id, "delete")).toBeUndefined();
    const third = await createQuote(quoteInput(first.customer.id, year), admin);
    expect(third.number).not.toBe(second.quote.number);
    const activity = await listRecentHomeActivity(30);
    const row = activity.find((a) => a.entityId === second.quote.id);
    expect(row?.summary).toContain("Deleted");
    expect(row?.href).toBeNull();
  });

  it("deletes a void quote and keeps its DocumentVoid row", async () => {
    const year = await freshYear();
    const { quote } = await draftQuote(year);
    await voidQuote(quote.id, REASON, admin);
    const voidsBefore = await db.documentVoid.count({ where: { docType: "QUOTE", docId: quote.id } });
    expect(voidsBefore).toBe(1);
    await deleteQuote(quote.id, REASON, admin);
    expect(await db.quote.findUnique({ where: { id: quote.id } })).toBeNull();
    expect(await db.documentVoid.count({ where: { docType: "QUOTE", docId: quote.id } })).toBe(1);
  });

  it("refuses a sent quote and a quote that has any sales order", async () => {
    const year = await freshYear();
    const sent = await draftQuote(year);
    await db.quote.update({ where: { id: sent.quote.id }, data: { status: "SENT" } });
    await expect(deleteQuote(sent.quote.id, REASON, admin)).rejects.toThrow(/draft or void/i);

    const { quote, so } = await voidedSo(year);
    await voidQuote(quote.id, REASON, admin);
    await expect(deleteQuote(quote.id, REASON, admin)).rejects.toThrow(/sales order/i);
    expect(await db.salesOrder.findUnique({ where: { id: so.id } })).not.toBeNull();
    expect(await db.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();
  });

  it("refuses a quote with an attachment, including an archived one", async () => {
    const year = await freshYear();
    const { quote } = await draftQuote(year);
    await db.documentAttachment.create({
      data: {
        quoteId: quote.id,
        fileName: "note.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `q-${tag()}`,
        sha256: "ab".repeat(32),
        uploadedById: admin.id,
        archivedAt: new Date(),
      },
    });
    await expect(deleteQuote(quote.id, REASON, admin)).rejects.toThrow(/attachment/i);
  });

  it("rolls back a forced mid-delete failure", async () => {
    const year = await freshYear();
    const { quote } = await draftQuote(year);
    const reminder = await createReminder(admin.id, {
      entityType: "QUOTE",
      entityId: quote.id,
      remindAt: `${year}-04-02`,
      note: "Keep",
    });
    const items = await db.quoteItem.count({ where: { quoteId: quote.id } });
    armDocumentDeleteFailure();
    await expect(deleteQuote(quote.id, REASON, admin)).rejects.toThrow(/forced document delete failure/);
    expect(await db.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();
    expect(await db.quoteItem.count({ where: { quoteId: quote.id } })).toBe(items);
    expect(await db.auditLog.count({ where: { entityType: "Quote", entityId: quote.id, action: "delete" } })).toBe(0);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).doneAt).toBeNull();
  });

  it("a delete inside the same transaction but outside the service still throws", async () => {
    const year = await freshYear();
    const { quote } = await draftQuote(year);
    await db.$transaction(async (tx) => {
      await expect(tx.quote.delete({ where: { id: quote.id } })).rejects.toBeInstanceOf(HardDeleteError);
      expect(await tx.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();
    });
  });

  it("deletes a void sales order and refuses the wrong status and every link", async () => {
    const year = await freshYear();
    const openYear = await freshYear();
    const closed = await voidedSo(openYear);
    await db.salesOrder.update({ where: { id: closed.so.id }, data: { status: "OPEN" } });
    await expect(deleteSalesOrder(closed.so.id, REASON, admin)).rejects.toThrow(/void sales order/i);

    const clean = await voidedSo(year);
    const reminder = await createReminder(admin.id, {
      entityType: "SALES_ORDER",
      entityId: clean.so.id,
      remindAt: `${year}-05-01`,
      note: "SO",
    });
    const voids = await db.documentVoid.count({ where: { docType: "SALES_ORDER", docId: clean.so.id } });
    expect(voids).toBe(1);
    const before = await db.documentSeries.findUnique({ where: { docType_year: { docType: "SALES_ORDER", year } } });
    await deleteSalesOrder(clean.so.id, REASON, admin);
    const after = await db.documentSeries.findUnique({ where: { docType_year: { docType: "SALES_ORDER", year } } });
    expect(after?.nextNumber).toBe(before?.nextNumber);
    expect(await db.salesOrder.findUnique({ where: { id: clean.so.id } })).toBeNull();
    expect(await db.documentVoid.count({ where: { docType: "SALES_ORDER", docId: clean.so.id } })).toBe(1);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).doneAt).not.toBeNull();

    const billed = await openThenBill(await freshYear(), nextInvoice());
    await voidBilling(billed.billing.id, REASON, admin);
    await voidSalesOrder(billed.so.id, REASON, admin);
    await expect(deleteSalesOrder(billed.so.id, REASON, admin)).rejects.toThrow(/Delete the billing first/);

    const textSo = await voidedSo(await freshYear());
    await db.orderTextSent.create({
      data: { eventKey: `txt-${tag()}`, kind: "confirmed", salesOrderId: textSo.so.id, sourceId: textSo.so.id },
    });
    await expect(deleteSalesOrder(textSo.so.id, REASON, admin)).rejects.toThrow(/order text/i);

    const poSo = await voidedSo(await freshYear());
    const poRow = await db.salesOrder.findUniqueOrThrow({ where: { id: poSo.so.id } });
    await db.purchaseOrder.create({
      data: {
        number: `PO-${tag()}`,
        supplierId: poSo.supplier.id,
        salesOrderId: poSo.so.id,
        date: new Date(Date.UTC(year, 2, 3)),
        settingsVersionId: poRow.settingsVersionId,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    await expect(deleteSalesOrder(poSo.so.id, REASON, admin)).rejects.toThrow(/purchase order/i);

    const retSo = await voidedSo(await freshYear());
    await db.customerReturn.create({
      data: {
        number: `CM-${tag()}`,
        salesOrderId: retSo.so.id,
        returnDate: new Date(Date.UTC(year, 2, 4)),
        createdById: admin.id,
      },
    });
    await expect(deleteSalesOrder(retSo.so.id, REASON, admin)).rejects.toThrow(/customer return/i);

    const drSo = await voidedSo(await freshYear());
    await db.delivery.create({
      data: {
        salesOrderId: drSo.so.id,
        drNumber: `DR-${tag()}`,
        deliveryDate: new Date(Date.UTC(year, 2, 4)),
        createdById: admin.id,
      },
    });
    await expect(deleteSalesOrder(drSo.so.id, REASON, admin)).rejects.toThrow(/delivery/i);
  });

  it("deletes a void billing with no links, keeps the SI claim, and shows it in Books", async () => {
    const year = await freshYear();
    const { customer, billing } = await openThenBill(year, nextInvoice());
    await voidBilling(billing.id, REASON, admin);
    const claimBefore = await db.bookletSerialClaim.findUnique({
      where: { type_number: { type: "SI", number: billing.invoiceNo } },
    });
    expect(claimBefore).not.toBeNull();
    const spoiled = await db.spoiledBookletNumber.count({ where: { type: "SI", number: billing.invoiceNo } });
    const seriesBefore = await db.documentSeries.findUnique({ where: { docType_year: { docType: "BILLING", year } } });
    const booksBefore = await getBookRegister(admin, "sales", `${year}-01-01`, `${year}-12-31`);
    await deleteBilling(billing.id, REASON, admin);
    const seriesAfter = await db.documentSeries.findUnique({ where: { docType_year: { docType: "BILLING", year } } });
    expect(seriesAfter?.nextNumber).toBe(seriesBefore?.nextNumber);
    expect(await db.billing.findUnique({ where: { id: billing.id } })).toBeNull();
    expect(await db.documentVoid.count({ where: { docType: "BILLING", docId: billing.id } })).toBe(1);
    expect(
      await db.bookletSerialClaim.findUnique({ where: { type_number: { type: "SI", number: billing.invoiceNo } } }),
    ).not.toBeNull();
    expect(await db.spoiledBookletNumber.count({ where: { type: "SI", number: billing.invoiceNo } })).toBe(spoiled);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Billing", entityId: billing.id, action: "delete" },
    });
    const snap = audit.before as { invoiceNo: number; total: string; reason: string; customer: string };
    expect(snap.invoiceNo).toBe(billing.invoiceNo);
    expect(snap.total).toBe("10000.00");
    expect(snap.reason).toBe(REASON);
    expect(snap.customer).toBe(customer.name);
    expect(auditSentence({ ...audit, before: audit.before, after: audit.after }, billing.number, admin)).toContain(`SI no. ${billing.invoiceNo}`);
    await expect(
      recordBilling(
        {
          salesOrderId: (await db.salesOrder.findFirstOrThrow({ where: { customerId: customer.id } })).id,
          amount: "1000.00",
          invoiceNo: billing.invoiceNo,
          invoiceDate: new Date(Date.UTC(year, 2, 6)),
          dueDate: new Date(Date.UTC(year, 3, 6)),
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/already used|spoiled/i);
    const rows = await listBookSourceRows(admin);
    const line = rows.find((r) => r.id === `deleted-${billing.id}`);
    expect(line?.documentNumber).toBe(`INV-${billing.invoiceNo}`);
    expect(line?.particulars).toBe(`Deleted (void), SI no. INV-${billing.invoiceNo}`);
    expect(line?.voided).toBe(true);
    expect(line?.href).toBeNull();
    const booksAfter = await getBookRegister(admin, "sales", `${year}-01-01`, `${year}-12-31`);
    expect(booksAfter.register.rows.some((r) => r.particulars === `Deleted (void), SI no. INV-${billing.invoiceNo}`)).toBe(true);
    expect(booksAfter.register.salesPeriodTotals?.invoicedAmount).toBe(booksBefore.register.salesPeriodTotals?.invoicedAmount);
    const activity = await listRecentHomeActivity(30);
    const hit = activity.find((a) => a.entityId === billing.id);
    expect(hit?.summary).toContain("Deleted");
    expect(hit?.href).toBeNull();
  });

  it("refuses a void billing that has allocations, tax, an attachment, or return credit", async () => {
    const year = await freshYear();
    const fromVoidCollection = await openThenBill(year, nextInvoice());
    const collection = await recordCollection(
      {
        customerId: fromVoidCollection.customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "100.00",
        notes: null,
        allocations: [{ billingId: fromVoidCollection.billing.id, cashApplied: "100.00", withholdingApplied: "0.00" }],
      },
      admin,
    );
    await voidCollection(collection.id, REASON, admin);
    await voidBilling(fromVoidCollection.billing.id, REASON, admin);
    await expect(deleteBilling(fromVoidCollection.billing.id, REASON, admin)).rejects.toThrow(/allocation/i);

    const fromPosted = await openThenBill(await freshYear(), nextInvoice());
    await recordCollection(
      {
        customerId: fromPosted.customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "50.00",
        notes: null,
        allocations: [{ billingId: fromPosted.billing.id, cashApplied: "50.00", withholdingApplied: "0.00" }],
      },
      admin,
    );
    await db.billing.update({
      where: { id: fromPosted.billing.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: REASON },
    });
    await expect(deleteBilling(fromPosted.billing.id, REASON, admin)).rejects.toThrow(/allocation/i);

    const taxed = await openThenBill(await freshYear(), nextInvoice());
    await voidBilling(taxed.billing.id, REASON, admin);
    await db.withholding2307.create({
      data: { billingId: taxed.billing.id, customerId: taxed.customer.id, rate: "0.0100", amount: "1.00" },
    });
    await expect(deleteBilling(taxed.billing.id, REASON, admin)).rejects.toThrow(/withholding|2307/i);

    const attached = await openThenBill(await freshYear(), nextInvoice());
    await voidBilling(attached.billing.id, REASON, admin);
    await db.documentAttachment.create({
      data: {
        billingId: attached.billing.id,
        fileName: "scan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `b-${tag()}`,
        sha256: "cd".repeat(32),
        uploadedById: admin.id,
        archivedAt: new Date(),
      },
    });
    await expect(deleteBilling(attached.billing.id, REASON, admin)).rejects.toThrow(/attachment/i);

    const credited = await openThenBill(await freshYear(), nextInvoice());
    const ret = await db.customerReturn.create({
      data: {
        number: `CM-${tag()}`,
        salesOrderId: credited.so.id,
        returnDate: new Date(Date.UTC(year, 2, 8)),
        createdById: admin.id,
      },
    });
    const credit = await db.customerCredit.create({
      data: { customerId: credited.customer.id, customerReturnId: ret.id, amount: "10.00", createdById: admin.id },
    });
    await db.customerCreditApplication.create({
      data: { customerCreditId: credit.id, billingId: credited.billing.id, cashApplied: "10.00" },
    });
    await db.billing.update({
      where: { id: credited.billing.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: REASON },
    });
    await expect(deleteBilling(credited.billing.id, REASON, admin)).rejects.toThrow(/return credit/i);

    const live = await openThenBill(await freshYear(), nextInvoice());
    await expect(deleteBilling(live.billing.id, REASON, admin)).rejects.toThrow(/void billing/i);
  });

  it("deletes a void collection with no receipt or allocation, and refuses the rest", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const clean = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "80.00",
        isDeposit: true,
        notes: null,
        allocations: [],
      },
      admin,
    );
    await voidCollection(clean.id, REASON, admin);
    const before = await db.documentSeries.findUnique({ where: { docType_year: { docType: "COLLECTION", year } } });
    await deleteCollection(clean.id, REASON, admin);
    const after = await db.documentSeries.findUnique({ where: { docType_year: { docType: "COLLECTION", year } } });
    expect(after?.nextNumber).toBe(before?.nextNumber);
    expect(await db.collection.findUnique({ where: { id: clean.id } })).toBeNull();
    expect(await db.documentVoid.count({ where: { docType: "COLLECTION", docId: clean.id } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Collection", entityId: clean.id, action: "delete" },
    });
    expect((audit.before as { reason: string; total: string }).reason).toBe(REASON);
    expect((audit.before as { total: string }).total).toBe("80.00");
    expect(auditRecordLink("Collection", clean.id, "delete")).toBeUndefined();

    const posted = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 7)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "10.00",
        isDeposit: true,
        notes: null,
        allocations: [],
      },
      admin,
    );
    await expect(deleteCollection(posted.id, REASON, admin)).rejects.toThrow(/void collection/i);

    const receipt = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 8)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-55",
        amountReceived: "10.00",
        isDeposit: true,
        notes: null,
        allocations: [],
      },
      admin,
    );
    await voidCollection(receipt.id, REASON, admin);
    await expect(deleteCollection(receipt.id, REASON, admin)).rejects.toThrow(/receipt/i);

    const { customer: payer, billing } = await openThenBill(await freshYear(), nextInvoice());
    const allocated = await recordCollection(
      {
        customerId: payer.id,
        date: new Date(Date.UTC(year, 2, 9)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "25.00",
        notes: null,
        allocations: [{ billingId: billing.id, cashApplied: "25.00", withholdingApplied: "0.00" }],
      },
      admin,
    );
    await voidCollection(allocated.id, REASON, admin);
    await expect(deleteCollection(allocated.id, REASON, admin)).rejects.toThrow(/allocation/i);

    const taxed = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 10)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "15.00",
        isDeposit: true,
        notes: null,
        allocations: [],
      },
      admin,
    );
    await voidCollection(taxed.id, REASON, admin);
    await db.withholding2307.create({
      data: { collectionId: taxed.id, customerId: customer.id, rate: "0.0100", amount: "0.00" },
    });
    await expect(deleteCollection(taxed.id, REASON, admin)).rejects.toThrow(/withholding|2307/i);

    const attached = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 11)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: null,
        amountReceived: "12.00",
        isDeposit: true,
        notes: null,
        allocations: [],
      },
      admin,
    );
    await voidCollection(attached.id, REASON, admin);
    await db.documentAttachment.create({
      data: {
        collectionId: attached.id,
        fileName: "or.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `c-${tag()}`,
        sha256: "ef".repeat(32),
        uploadedById: admin.id,
        archivedAt: new Date(),
      },
    });
    await expect(deleteCollection(attached.id, REASON, admin)).rejects.toThrow(/attachment/i);
  });

  it("an admin delete action redirects and removes the quote", async () => {
    const year = await freshYear();
    const { quote } = await draftQuote(year);
    asActor(admin);
    await expect(deleteQuoteAction(quote.id, REASON)).rejects.toThrow(`NEXT_REDIRECT:/quotes`);
    expect(await db.quote.findUnique({ where: { id: quote.id } })).toBeNull();
  });
});
