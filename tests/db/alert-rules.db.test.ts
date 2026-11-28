// Adoption item 8 (Review Board run 103): email alert rules (MySQL).
//
// A1 Quote approved -> one alert per active Admin/Approver (never staff,
//    viewers or inactive admins); audit send_email with after.alert="sent".
// A2 Quote converted -> the sales-order-confirmed alert fires, audited.
// A3 Collection recorded -> alert + audit. With the collection rule OFF,
//    no mail goes out and the collection still records.
// A4 Supplier payment recorded -> alert + audit.
// A5 A throwing mailer never blocks the business action; the audit
//    records the send as "failed".
// A6 Goods received runs through the engine: the default rule reproduces
//    the item-5 recipient set (PO creator + Admins + Approvers) plus the
//    rule's extra address, exactly one email each, and the audit row
//    keeps its item-5 shape (after.receivingEmail). Rule OFF -> nothing.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { setMailer, type Mail } from "@/lib/mailer";
import { getSettingsSnapshot, saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import type { Settings } from "@/lib/settings/schema";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import {
  approvePurchaseOrder,
  createPurchaseOrdersFromSalesOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
} from "@/lib/services/purchase-orders";
import { postReceivingReport } from "@/lib/services/receiving";
import { recordBilling } from "@/lib/services/billings";
import { recordCollection } from "@/lib/services/collections";
import { recordSupplierBill } from "@/lib/services/supplier-bills";
import { recordSupplierPayment } from "@/lib/services/supplier-payments";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, paymentProof, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("Adoption item 8 alert rules (MySQL)", () => {
  let admin: DocActor; // Admin + Approver + costs
  let staff: DocActor;
  let approverEmail: string;
  let staffEmail: string;
  const sent: Mail[] = [];
  let invoiceSeq = 700_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-alerts-uploads-"));
    admin = await makeUser("costs");
    staff = await makeUser("staff");
    staffEmail = (staff as unknown as { email: string }).email;
    await makeUser("viewer");
    const t = tag();
    approverEmail = `approver-alerts-${t}@test.example.com`;
    await db.user.create({
      data: { email: approverEmail, name: `Approver Only ${t}`, isApprover: true },
    });
    await db.user.create({
      data: { email: `inactive-admin-${t}@test.example.com`, name: `Inactive Admin ${t}`, isAdmin: true, active: false },
    });
  });

  beforeEach(() => {
    sent.length = 0;
    setMailer({
      async send(mail) {
        sent.push(mail);
      },
    });
  });

  afterAll(async () => {
    setMailer(null);
    // Leave the shared test DB's settings as we found them: defaults.
    const snap = await getSettingsSnapshot();
    await saveSettings({
      key: "alerts",
      value: DEFAULT_SETTINGS.alerts,
      userId: admin.id,
      baseVersionId: snap.versionId,
    });
    await db.$disconnect();
  });

  /** The recipient set the default rule (Admins + Approvers) should compute right now. */
  async function expectedRoleRecipients(): Promise<Set<string>> {
    const users = await db.user.findMany({
      where: { active: true, OR: [{ isAdmin: true }, { isApprover: true }] },
      select: { email: true },
    });
    return new Set(users.map((u) => u.email));
  }

  async function saveAlerts(patch: Partial<Settings["alerts"]>) {
    const snap = await getSettingsSnapshot();
    const res = await saveSettings({
      key: "alerts",
      value: { ...snap.settings.alerts, ...patch },
      userId: admin.id,
      baseVersionId: snap.versionId,
    });
    expect(res.ok).toBe(true);
  }

  async function setRule(key: keyof Settings["alerts"], rule: Settings["alerts"][typeof key]) {
    const snap = await getSettingsSnapshot();
    await saveAlerts({ [key]: rule } as Partial<Settings["alerts"]>);
    return snap.settings.alerts[key];
  }

  /** Parallel suites can republish settings with the default 1–500 booklet. */
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

  /** Quote (PENDING approval: total above the approval threshold) -> approved -> SO. */
  async function approvedSo(year: number) {
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
          {
            id: null,
            description: `Alert Widget ${tag()}`,
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "100",
            unitPrice: "600000",
          },
        ],
      },
      admin,
    );
    return { customer, supplier, q };
  }

  async function convert(qId: string, customerId: string, year: number) {
    const deliveryAddressId = await customerDeliveryAddressId(customerId);
    return convertQuoteToSalesOrder(qId, { buyerPoNo: `BP-${year}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
  }

  it("A1+A2: quote approved, then converted — both alerts fire once per Admin/Approver, audited", async () => {
    const year = await freshYear();
    const { customer, q } = await approvedSo(year);
    const before = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(before.approvalStatus).toBe("PENDING");

    const want = await expectedRoleRecipients();
    expect(want.has(approverEmail)).toBe(true);
    expect(want.has(staffEmail)).toBe(false);

    await approveQuote(q.id, admin);
    const quoteMails = sent.filter((m) => m.subject === `Quote approved — ${q.number}`);
    expect(new Set(quoteMails.map((m) => m.to))).toEqual(want);
    expect(quoteMails).toHaveLength(want.size);
    expect(quoteMails[0]!.text).toContain(customer.name);
    const qAudit = await db.auditLog.findFirst({
      where: { entityType: "Quote", entityId: q.id, action: "send_email" },
    });
    expect((qAudit!.after as { alert?: string; event?: string }).alert).toBe("sent");
    expect((qAudit!.after as { event?: string }).event).toBe("quoteApproved");

    sent.length = 0;
    const so = await convert(q.id, customer.id, year);
    const soMails = sent.filter((m) => m.subject === `Sales order confirmed — ${so.number}`);
    expect(new Set(soMails.map((m) => m.to))).toEqual(want);
    expect(soMails).toHaveLength(want.size);
    const soAudit = await db.auditLog.findFirst({
      where: { entityType: "SalesOrder", entityId: so.id, action: "send_email" },
    });
    expect((soAudit!.after as { alert?: string; event?: string }).alert).toBe("sent");
    expect((soAudit!.after as { event?: string }).event).toBe("salesOrderConfirmed");
  });

  /** SO -> billing -> collection; returns the collection row. */
  async function collectOnce(year: number) {
    await ensureWideBooklet();
    const { customer, q } = await approvedSo(year);
    await approveQuote(q.id, admin);
    const so = await convert(q.id, customer.id, year);
    const soRow = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
    const contract = String(soRow.contractPrice);
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: contract,
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
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
        receiptNo: `OR-ALERT-${tag()}`,
        amountReceived: contract,
        notes: null,
        allocations: [
          { billingId: billing.id, cashApplied: contract, withholdingApplied: "0", withholdingRate: "0.0000", atcCode: null },
        ],
      },
      admin,
    );
    return { customer, collection };
  }

  it("A3: collection recorded — alert + audit; rule OFF -> no mail, collection still records", async () => {
    const year = await freshYear();
    const want = await expectedRoleRecipients();
    const { collection } = await collectOnce(year);
    const mails = sent.filter((m) => m.subject === `Collection recorded — ${collection.number}`);
    expect(new Set(mails.map((m) => m.to))).toEqual(want);
    expect(mails).toHaveLength(want.size);
    const audit = await db.auditLog.findFirst({
      where: { entityType: "Collection", entityId: collection.id, action: "send_email" },
    });
    expect((audit!.after as { alert?: string; event?: string }).alert).toBe("sent");
    expect((audit!.after as { event?: string }).event).toBe("collection");

    const original = await setRule("collection", {
      ...DEFAULT_SETTINGS.alerts.collection,
      enabled: false,
    });
    try {
      sent.length = 0;
      const year2 = await freshYear();
      const second = await collectOnce(year2);
      expect(sent.filter((m) => m.subject.includes("Collection recorded"))).toHaveLength(0);
      const row = await db.collection.findUnique({ where: { id: second.collection.id } });
      expect(row).not.toBeNull();
      const offAudit = await db.auditLog.findFirst({
        where: { entityType: "Collection", entityId: second.collection.id, action: "send_email" },
      });
      expect(offAudit).toBeNull();
    } finally {
      await setRule("collection", original);
    }
  });

  it("A4: supplier payment recorded — alert + audit", async () => {
    const year = await freshYear();
    const supplier = await makeSupplier();
    const t = tag();
    const po = await createStandalonePurchaseOrder(
      {
        supplierId: supplier.id,
        supplierContactId: null,
        date: new Date(Date.UTC(year, 2, 1)),
        expectedDate: null,
        terms: "Net 30",
        deliveryAddressText: null,
        supplierAddressText: null,
        notes: null,
        items: [{ id: null, description: "Widget", kind: "GOODS", qty: "1", unit: "lot", unitCost: "5000.00" }],
      },
      admin,
    );
    await markPurchaseOrderSent(po.id, admin);
    const bill = await recordSupplierBill(
      po.id,
      { billNumber: `SB-ALERT-${t}`, billDate: new Date(Date.UTC(year, 2, 5)), amount: "5000.00", notes: null, lines: [] },
      admin,
    );
    const want = await expectedRoleRecipients();
    const pay = await recordSupplierPayment(
      {
        supplierId: supplier.id,
        date: new Date(Date.UTC(year, 2, 8)),
        method: "BANK_TRANSFER",
        reference: `REF-${t}`,
        checkBank: null,
        checkDate: null,
        amountPaid: "5000.00",
        notes: null,
        cashAccountId: null,
        allocations: [
          { supplierBillId: bill.id, cashApplied: "5000.00", withholdingApplied: "0", withholdingRate: "0.0000", atcCode: null },
        ],
      },
      admin,
      paymentProof,
    );
    const mails = sent.filter((m) => m.subject === `Supplier payment recorded — ${pay.number}`);
    expect(new Set(mails.map((m) => m.to))).toEqual(want);
    expect(mails).toHaveLength(want.size);
    expect(mails[0]!.text).toContain(supplier.name);
    const audit = await db.auditLog.findFirst({
      where: { entityType: "SupplierPayment", entityId: pay.id, action: "send_email" },
    });
    expect((audit!.after as { alert?: string; event?: string }).alert).toBe("sent");
    expect((audit!.after as { event?: string }).event).toBe("supplierPayment");
  });

  it("A5: a throwing mailer never blocks the collection; the failure is audited", async () => {
    setMailer({
      async send() {
        throw new Error("SMTP down");
      },
    });
    const year = await freshYear();
    const { collection } = await collectOnce(year);
    const row = await db.collection.findUnique({ where: { id: collection.id } });
    expect(row).not.toBeNull();
    const audit = await db.auditLog.findFirst({
      where: { entityType: "Collection", entityId: collection.id, action: "send_email" },
    });
    expect((audit!.after as { alert?: string }).alert).toBe("failed");
  });

  it("A6: goods received via the engine — item-5 set + rule extra address; rule OFF -> nothing", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const t = tag();
    const creatorEmail = `creator-alerts-${t}@test.example.com`;
    const creator = (await db.user.create({
      data: { email: creatorEmail, name: `PO Creator ${t}`, isStaff: true, canSeeCosts: true },
    })) as DocActor;
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: `Recv Widget ${t}`, kind: "GOODS", qty: "10", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "150" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const so = await convert(q.id, customer.id, year);
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    await db.purchaseOrder.update({ where: { id: po!.id }, data: { createdById: creator.id } });
    await approvePurchaseOrder(po!.id, admin);
    await markPurchaseOrderSent(po!.id, admin);
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po!.id } });

    const extra = `alerts-extra-${t}@example.com`;
    const original = await setRule("goodsReceived", {
      ...DEFAULT_SETTINGS.alerts.goodsReceived,
      emails: [extra],
    });
    try {
      const want = await expectedRoleRecipients();
      want.add(creatorEmail);
      want.add(extra);
      const rr = await postReceivingReport(
        po!.id,
        {
          receivedDate: new Date(Date.UTC(year, 3, 1)),
          receivedById: staff.id,
          deliveryRef: "DR-ALERT",
          notes: null,
          lines: lines.map((l) => ({ lineId: l.id, qty: "4", warrantyEndDate: null, serialNumbers: null })),
        },
        staff,
      );
      const mails = sent.filter((m) => m.subject.includes(po!.number));
      expect(new Set(mails.map((m) => m.to))).toEqual(want);
      expect(mails).toHaveLength(want.size);
      const audit = await db.auditLog.findFirst({
        where: { entityType: "ReceivingReport", entityId: rr.id, action: "send_email" },
      });
      // The audit row keeps its item-5 shape.
      expect((audit!.after as { receivingEmail?: string }).receivingEmail).toBe("sent");

      // Rule OFF: a completing receiving sends nothing at all.
      await setRule("goodsReceived", { ...DEFAULT_SETTINGS.alerts.goodsReceived, enabled: false });
      sent.length = 0;
      await postReceivingReport(
        po!.id,
        {
          receivedDate: new Date(Date.UTC(year, 3, 2)),
          receivedById: staff.id,
          deliveryRef: "DR-ALERT-2",
          notes: null,
          lines: lines.map((l) => ({ lineId: l.id, qty: "6", warrantyEndDate: null, serialNumbers: null })),
        },
        staff,
      );
      expect(sent.filter((m) => m.subject.includes(po!.number))).toHaveLength(0);
    } finally {
      await setRule("goodsReceived", original);
    }
  });
});
