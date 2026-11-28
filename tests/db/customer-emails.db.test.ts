// Adoption item 16: customer auto-emails, extended (MySQL).
//
// P1 One collection settling two billings -> exactly ONE email per
//    billing, each with that billing's own figures (a part payment
//    shows the true remaining balance; a fully settled billing says
//    "paid in full"). Figures cross-checked against SQL.
// P2 Withholding: the email breaks the applied amount into cash +
//    withholding tax (Form 2307) in plain words.
// P3 Toggle OFF (features.customerPaymentEmailEnabled) -> the
//    collection still records; no email.
// P4 Customer with no email on file -> no send; the skip is audited.
// P5 Throwing mailer -> the collection still commits; audited failed.
// P6 Deposit collection (no allocations) -> no email (nothing settled).
// D1 Partial delivery -> one email: DR number, lines + quantities this
//    time, what remains. Completing delivery -> "completes your order".
// D2 Toggle OFF (features.customerDeliveryEmailEnabled) -> no email.
// D3 Voiding a delivery sends NO retraction email.
// D4 Customer with no email on file -> no send; the skip is audited.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { setMailer, type Mail } from "@/lib/mailer";
import { money } from "@/lib/documents/common";
import { getSettingsSnapshot, saveSettings } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import { recordCollection } from "@/lib/services/collections";
import { recordDelivery, voidDelivery } from "@/lib/services/deliveries";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput, tag } from "./fixtures";

async function widenBooklet(adminId: string, key: "salesInvoice" | "deliveryReceipt") {
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
    if ((ib[key]?.seriesTo ?? 0) >= 9_999_999) return;
    const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
    // salesInvoice: the snapshot reader lets the section's TOP-LEVEL
    // seriesTo override the salesInvoice sub-object, so widen the top
    // level by replacing the whole section (the collection-deductions
    // suite's proven shape). deliveryReceipt has no such override, so
    // replacing its sub-object is enough.
    const section =
      key === "salesInvoice"
        ? { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet customer emails" }
        : { ...ib, deliveryReceipt: { ...typeWide } };
    try {
      await db.settingsVersion.create({
        data: {
          version: latest.version + 1,
          data: { ...(latest.data as object), invoiceBooklet: section } as never,
          changedKey: "invoiceBooklet",
          before: ib,
          after: section,
          createdById: adminId,
        },
      });
      return;
    } catch {
      // Unique version race with another suite — retry.
    }
  }
}

async function setFeature(
  admin: DocActor,
  key: "customerPaymentEmailEnabled" | "customerDeliveryEmailEnabled",
  on: boolean,
) {
  const snap = await getSettingsSnapshot();
  const saved = await saveSettings({
    key: "features",
    value: { ...snap.settings.features, [key]: on },
    userId: admin.id,
    baseVersionId: snap.versionId,
  });
  expect(saved.ok).toBe(true);
}

describe.skipIf(!env.hasDb)("Adoption item 16 customer auto-emails (MySQL)", () => {
  let admin: DocActor;
  const sent: Mail[] = [];
  let invoiceSeq = 0;
  let drSeq = 910_000 + Math.floor(Math.random() * 50_000);
  const nextDr = () => String(++drSeq);

  async function nextInvoice(): Promise<number> {
    if (invoiceSeq === 0) {
      const [maxBilling, maxSpoiled, maxClaim] = await Promise.all([
        db.billing.aggregate({ _max: { invoiceNo: true } }),
        db.spoiledBookletNumber.aggregate({ _max: { number: true }, where: { type: "SI" } }),
        db.bookletSerialClaim.aggregate({ _max: { number: true }, where: { type: "SI" } }),
      ]);
      invoiceSeq =
        Math.max(880_000, Number(maxBilling._max.invoiceNo ?? 0), Number(maxSpoiled._max.number ?? 0), Number(maxClaim._max.number ?? 0)) +
        Math.floor(Math.random() * 500) +
        1;
    }
    for (let attempt = 0; attempt < 500; attempt++) {
      const candidate = ++invoiceSeq;
      const [takenBilling, spoiled, takenClaim] = await Promise.all([
        db.billing.findFirst({ where: { invoiceNo: candidate }, select: { id: true } }),
        db.spoiledBookletNumber.findFirst({ where: { type: "SI", number: candidate }, select: { id: true } }),
        db.bookletSerialClaim.findFirst({ where: { type: "SI", number: candidate }, select: { number: true } }),
      ]);
      if (!takenBilling && !spoiled && !takenClaim) return candidate;
    }
    throw new Error("Could not allocate unused SI number after 500 attempts");
  }

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-custmail-uploads-"));
    admin = await makeUser("costs");
    await widenBooklet(admin.id, "salesInvoice");
    await widenBooklet(admin.id, "deliveryReceipt");
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
    await db.$disconnect();
  });

  const paymentMails = () => sent.filter((m) => m.subject.startsWith("Payment received —"));
  const deliveryMails = () => sent.filter((m) => m.subject.startsWith("Delivery recorded —"));

  async function makeBilling(
    customer: { id: string },
    year: number,
    input: { description: string; kind: "GOODS" | "SERVICES"; qty: string; unit: string; unitPrice: string },
  ) {
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: input.description,
            kind: input.kind,
            qty: input.qty,
            unit: input.unit,
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: input.unitPrice,
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-16", deliveryAddressId }, admin);
    const amount = (Number(input.qty) * Number(input.unitPrice)).toFixed(2);
    for (let attempt = 0; attempt < 5; attempt++) {
      const invoiceNo = await nextInvoice();
      try {
        const billing = await recordBilling(
          { salesOrderId: so.id, amount, invoiceNo, invoiceDate: new Date(), dueDate: new Date(), notes: null },
          admin,
        );
        return { so, billing };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already used|spoiled/i.test(msg) && attempt < 4) continue;
        throw err;
      }
    }
    throw new Error("Failed to record billing after retries");
  }

  function collectionInput(customerId: string, extra: Record<string, unknown> = {}): Parameters<typeof recordCollection>[0] {
    return {
      customerId,
      date: new Date(),
      method: "GCASH",
      reference: "CE-REF-1",
      checkBank: null,
      checkDate: null,
      receiptNo: null,
      amountReceived: "0.00",
      notes: null,
      allocations: [],
      ...extra,
    } as Parameters<typeof recordCollection>[0];
  }

  async function latestEmailAudit(entityType: "Billing" | "Delivery", entityId: string) {
    return db.auditLog.findFirst({
      where: { entityType, entityId, action: "send_email" },
      orderBy: { at: "desc" },
    });
  }

  it("P1: one collection, two billings — one email per billing with that billing's own figures", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const buyerEmail = customer.contacts[0]!.email!;
    const a = await makeBilling(customer, year, { description: "CustMail Widget A", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "1000" });
    const b = await makeBilling(customer, year, { description: "CustMail Widget B", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "1000" });

    // (recordCollection itself refuses a billing twice in one
    // allocation list, so each billing appears once here; the notify
    // step still groups by billing defensively.)
    await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "1400.00",
        allocations: [
          { billingId: a.billing.id, cashApplied: "400.00", withholdingApplied: "0.00" },
          { billingId: b.billing.id, cashApplied: "1000.00", withholdingApplied: "0.00" },
        ],
      }),
      admin,
    );

    const mails = paymentMails();
    expect(mails).toHaveLength(2);
    expect(mails.every((m) => m.to === buyerEmail)).toBe(true);

    // SQL cross-check: A's balance = amount − Σ POSTED allocations.
    const aAllocs = await db.collectionAllocation.findMany({
      where: { billingId: a.billing.id, collection: { status: "POSTED" } },
    });
    const aApplied = aAllocs.reduce((s, x) => s + Number(x.cashApplied) + Number(x.withholdingApplied), 0);
    expect(aApplied).toBe(400);
    const mailA = mails.find((m) => m.subject === `Payment received — ${a.billing.number}`)!;
    expect(mailA.text).toContain("Amount applied to this billing: ₱400.00");
    expect(mailA.text).toContain("Remaining balance on this billing: ₱600.00");
    expect(mailA.text).toContain(`sales order ${a.so.number}`);
    expect(mailA.text).not.toContain(b.billing.number);

    const mailB = mails.find((m) => m.subject === `Payment received — ${b.billing.number}`)!;
    expect(mailB.text).toContain("Amount applied to this billing: ₱1,000.00");
    expect(mailB.text).toContain("This billing is now paid in full.");
    expect(mailB.text).not.toContain("Remaining balance");

    for (const billing of [a.billing, b.billing]) {
      const audit = await latestEmailAudit("Billing", billing.id);
      const after = audit!.after as { customerEmail?: string; event?: string; to?: string };
      expect(after.customerEmail).toBe("sent");
      expect(after.event).toBe("customerPaymentReceived");
      expect(after.to).toBe(buyerEmail);
    }
  });

  it("P2: withholding is named in plain words beside the cash", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const { billing } = await makeBilling(customer, year, {
      description: "CustMail Consulting",
      kind: "SERVICES",
      qty: "1",
      unit: "lot",
      unitPrice: "1000",
    });
    await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "880.00",
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "880.00",
            withholdingApplied: "120.00",
            codes: [
              { rate: "0.0200", atcCode: "WI157", amount: "70.00" },
              { rate: "0.0500", atcCode: "WV010/WV020", amount: "50.00" },
            ],
          },
        ],
      }),
      admin,
    );
    const mails = paymentMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("Amount applied to this billing: ₱1,000.00");
    expect(mails[0]!.text).toContain("Received in cash: ₱880.00");
    expect(mails[0]!.text).toContain("Covered by withholding tax (Form 2307): ₱120.00");
    expect(mails[0]!.text).toContain("This billing is now paid in full.");
  });

  it("P3: toggle OFF — the collection records, no email is sent", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const { billing } = await makeBilling(customer, year, { description: "CustMail Toggle", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "500" });
    await setFeature(admin, "customerPaymentEmailEnabled", false);
    try {
      const col = await recordCollection(
        collectionInput(customer.id, {
          amountReceived: "500.00",
          allocations: [{ billingId: billing.id, cashApplied: "500.00", withholdingApplied: "0.00" }],
        }),
        admin,
      );
      expect(col.status).toBe("POSTED");
      expect(paymentMails()).toHaveLength(0);
    } finally {
      await setFeature(admin, "customerPaymentEmailEnabled", true);
    }
  });

  it("P4: no email on file — nothing sent, the skip is audited", async () => {
    const year = await freshYear();
    const t = tag();
    const customer = await db.customer.create({
      data: {
        name: `No Email Customer ${t}`,
        withholdingType: "NONE",
        defaultTerms: "Net 30",
        address: "Test address",
        contacts: { create: [{ name: `Buyer ${t}`, isMain: true }] },
      },
      include: { contacts: true },
    });
    const { billing } = await makeBilling(customer, year, {
      description: "CustMail NoEmail",
      kind: "GOODS",
      qty: "1",
      unit: "pc",
      unitPrice: "500",
    });
    await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "500.00",
        allocations: [{ billingId: billing.id, cashApplied: "500.00", withholdingApplied: "0.00" }],
      }),
      admin,
    );
    expect(paymentMails()).toHaveLength(0);
    const audit = await latestEmailAudit("Billing", billing.id);
    const after = audit!.after as { customerEmail?: string; event?: string; reason?: string };
    expect(after.customerEmail).toBe("skipped");
    expect(after.event).toBe("customerPaymentReceived");
    expect(after.reason).toBe("no_recipient");
  });

  it("P5: throwing mailer — the collection still commits and the failure is audited", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const { billing } = await makeBilling(customer, year, { description: "CustMail Fragile", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "500" });
    setMailer({
      async send() {
        throw new Error("SMTP down (test)");
      },
    });
    const col = await recordCollection(
      collectionInput(customer.id, {
        amountReceived: "500.00",
        allocations: [{ billingId: billing.id, cashApplied: "500.00", withholdingApplied: "0.00" }],
      }),
      admin,
    );
    const stored = await db.collection.findUniqueOrThrow({ where: { id: col.id } });
    expect(stored.status).toBe("POSTED");
    expect(money(stored.amountReceived)).toBe("500.00");
    const audit = await latestEmailAudit("Billing", billing.id);
    const after = audit!.after as { customerEmail?: string; event?: string };
    expect(after.customerEmail).toBe("failed");
    expect(after.event).toBe("customerPaymentReceived");
  });

  it("P6: a deposit (no allocations) sends no payment email", async () => {
    const customer = await makeCustomer();
    await recordCollection(
      collectionInput(customer.id, { amountReceived: "700.00", isDeposit: true, allocations: [] }),
      admin,
    );
    expect(paymentMails()).toHaveLength(0);
  });

  async function makeDeliverableSo(
    customer: { id: string },
    year: number,
  ) {
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          { id: null, description: "CustMail Widget D", kind: "GOODS", qty: "10", unit: "pcs", supplierId: null, supplierUnitCost: "0", unitPrice: "100" },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-16D", deliveryAddressId }, admin);
    const withItems = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    return { so, itemId: withItems.items[0]!.id };
  }

  it("D1: partial delivery emails the lines + remainder; the completing delivery says so", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const buyerEmail = customer.contacts[0]!.email!;
    const { so, itemId } = await makeDeliverableSo(customer, year);

    const dr1 = nextDr();
    const del1 = await recordDelivery(
      so.id,
      { drNumber: dr1, deliveryDate: new Date(), receivedBy: "Juan Dela Cruz", idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "6.00" }] },
      admin,
    );
    let mails = deliveryMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(buyerEmail);
    expect(mails[0]!.text).toContain(`Delivery receipt: ${dr1}`);
    expect(mails[0]!.text).toContain("Received by: Juan Dela Cruz");
    expect(mails[0]!.text).toContain("- CustMail Widget D — 6 pcs");
    expect(mails[0]!.text).toContain("- CustMail Widget D — 4 pcs still to deliver");
    const audit1 = await latestEmailAudit("Delivery", del1.id);
    expect((audit1!.after as { customerEmail?: string; event?: string }).customerEmail).toBe("sent");
    expect((audit1!.after as { event?: string }).event).toBe("customerDeliveryRecorded");

    const dr2 = nextDr();
    await recordDelivery(
      so.id,
      { drNumber: dr2, deliveryDate: new Date(), idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "4.00" }] },
      admin,
    );
    mails = deliveryMails();
    expect(mails).toHaveLength(2);
    expect(mails[1]!.text).toContain("This completes your order");
    expect(mails[1]!.text).not.toContain("Still to deliver:");
  });

  it("D2: toggle OFF — the delivery records, no email is sent", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const { so, itemId } = await makeDeliverableSo(customer, year);
    await setFeature(admin, "customerDeliveryEmailEnabled", false);
    try {
      await recordDelivery(
        so.id,
        { drNumber: nextDr(), deliveryDate: new Date(), idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "5.00" }] },
        admin,
      );
      expect(deliveryMails()).toHaveLength(0);
    } finally {
      await setFeature(admin, "customerDeliveryEmailEnabled", true);
    }
  });

  it("D3: voiding a delivery sends no retraction email", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const { so, itemId } = await makeDeliverableSo(customer, year);
    const del = await recordDelivery(
      so.id,
      { drNumber: nextDr(), deliveryDate: new Date(), idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "5.00" }] },
      admin,
    );
    expect(deliveryMails()).toHaveLength(1);
    await voidDelivery(del.id, "Recorded in error (test)", admin);
    expect(deliveryMails()).toHaveLength(1);
  });

  it("D4: no email on file — nothing sent, the skip is audited", async () => {
    const year = await freshYear();
    const t = tag();
    const customer = await db.customer.create({
      data: {
        name: `No Email Delivery Customer ${t}`,
        withholdingType: "NONE",
        defaultTerms: "Net 30",
        address: "Test address",
        contacts: { create: [{ name: `Buyer ${t}`, isMain: true }] },
      },
      include: { contacts: true },
    });
    const { so, itemId } = await makeDeliverableSo(customer, year);
    const del = await recordDelivery(
      so.id,
      { drNumber: nextDr(), deliveryDate: new Date(), idSightChecked: false, items: [{ salesOrderItemId: itemId, qty: "5.00" }] },
      admin,
    );
    expect(deliveryMails()).toHaveLength(0);
    const audit = await latestEmailAudit("Delivery", del.id);
    const after = audit!.after as { customerEmail?: string; event?: string; reason?: string };
    expect(after.customerEmail).toBe("skipped");
    expect(after.event).toBe("customerDeliveryRecorded");
    expect(after.reason).toBe("no_recipient");
  });
});
