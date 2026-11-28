// Adoption item 5 (Review Board run 103): goods-received team email +
// bell twin (MySQL).
//
// R1 Partial receiving -> exactly one email per recipient (PO creator +
//    active Admin/Approver users; never viewers, staff bystanders or
//    inactive admins), partial wording, outstanding remainder named.
// R2 Completing receiving -> a second email with fully-received wording;
//    the bell's "Goods received" section lists the report.
// R3 Mailer failure -> the receiving still commits; the send is audited
//    as failed.
// R4 Voiding a receiving report sends NO email, and the bell drops it.
// R5 Settings toggle OFF (features.receivingEmailEnabled) -> no email.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { setMailer, type Mail } from "@/lib/mailer";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { approvePurchaseOrder, createPurchaseOrdersFromSalesOrder, markPurchaseOrderSent } from "@/lib/services/purchase-orders";
import { postReceivingReport, voidReceivingReport } from "@/lib/services/receiving";
import { getNotifications } from "@/lib/notifications";
import { getSettingsSnapshot, saveSettings } from "@/lib/settings";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("Adoption item 5 receiving email (MySQL)", () => {
  let admin: DocActor; // Admin + Approver + costs (fixtures "costs")
  let creator: DocActor; // Staff + costs, NOT Admin/Approver: recipient only via the creator rule
  let receiver: DocActor; // Staff, the physical receiver (receivedById)
  let creatorEmail: string;
  const sent: Mail[] = [];

  beforeAll(async () => {
    admin = await makeUser("costs");
    receiver = await makeUser("staff");
    await makeUser("viewer");
    const t = tag();
    creatorEmail = `creator-${t}@test.example.com`;
    creator = (await db.user.create({
      data: { email: creatorEmail, name: `PO Creator ${t}`, isStaff: true, canSeeCosts: true },
    })) as DocActor;
    await db.user.create({
      data: { email: `approver-${t}@test.example.com`, name: `Approver Only ${t}`, isApprover: true },
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
    await db.$disconnect();
  });

  /** The recipient set the notify step should compute right now. */
  async function expectedRecipients(poCreatorId: string): Promise<Set<string>> {
    const users = await db.user.findMany({
      where: { active: true, OR: [{ isAdmin: true }, { isApprover: true }, { id: poCreatorId }] },
      select: { email: true },
    });
    return new Set(users.map((u) => u.email));
  }

  /** Quote -> SO -> PO (createdById repointed to the staff `creator`), approved + sent. Lines: A qty 10, B qty 5. */
  async function buildPo() {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const descA = `RecvMail Widget A ${tag()}`;
    const descB = `RecvMail Widget B ${tag()}`;
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: descA, kind: "GOODS", qty: "10", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "150" },
          { id: null, description: descB, kind: "GOODS", qty: "5", unit: "pc", supplierId: supplier.id, supplierUnitCost: "200", unitPrice: "300" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "5 test", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "RM-5", deliveryAddressId: delivAddr.id }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    // PO creation is Admin-only in the app, so a non-admin creator arises
    // when the creator's roles change afterwards. Point the PO at the
    // staff creator directly to prove the recipient rule reads createdById.
    await db.purchaseOrder.update({ where: { id: po!.id }, data: { createdById: creator.id } });
    await approvePurchaseOrder(po!.id, admin);
    await markPurchaseOrderSent(po!.id, admin);
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po!.id }, orderBy: { sortOrder: "asc" } });
    return { po: po!, lines, descA, descB, year };
  }

  function receipt(year: number, lines: { lineId: string; qty: string }[]) {
    return {
      receivedDate: new Date(Date.UTC(year, 3, 1)),
      receivedById: receiver.id,
      deliveryRef: "DR-RM5",
      notes: null,
      lines: lines.map((l) => ({ ...l, warrantyEndDate: null, serialNumbers: null })),
    };
  }

  it("R1+R2: partial then completing receiving - one email per recipient, exact wording, bell lists it", async () => {
    const { po, lines, descA, descB, year } = await buildPo();
    const want = await expectedRecipients(creator.id);
    expect(want.has(creatorEmail)).toBe(true); // creator rule: staff, not admin/approver

    const rr1 = await postReceivingReport(
      po.id,
      receipt(year, [
        { lineId: lines[0]!.id, qty: "4" },
        { lineId: lines[1]!.id, qty: "0" },
      ]),
      receiver,
    );
    const mails1 = sent.filter((m) => m.subject.includes(po.number));
    expect(new Set(mails1.map((m) => m.to))).toEqual(want);
    expect(mails1).toHaveLength(want.size);
    const body = mails1[0]!.text;
    expect(mails1[0]!.subject).toContain("(partial)");
    expect(body).toContain(descA);
    expect(body).toContain("4 pc received (4 of 10 pc in total)");
    expect(body).toContain("Still outstanding:");
    expect(body).toContain(`${descA} — 6 pc still to come`);
    expect(body).toContain(`${descB} — 5 pc still to come`);
    expect(body).toContain(`/purchase-orders/${po.id}`);
    const audit1 = await db.auditLog.findFirst({
      where: { entityType: "ReceivingReport", entityId: rr1.id, action: "send_email" },
    });
    expect((audit1!.after as { receivingEmail?: string }).receivingEmail).toBe("sent");

    sent.length = 0;
    await postReceivingReport(
      po.id,
      receipt(year, [
        { lineId: lines[0]!.id, qty: "6" },
        { lineId: lines[1]!.id, qty: "5" },
      ]),
      receiver,
    );
    const mails2 = sent.filter((m) => m.subject.includes(po.number));
    expect(mails2).toHaveLength(want.size);
    expect(mails2[0]!.subject).toContain("fully received");
    expect(mails2[0]!.text).toContain("This completes the order");
    expect(mails2[0]!.text).not.toContain("Still outstanding:");

    const sections = await getNotifications(admin);
    const bell = sections.find((s) => s.key === "goods-received");
    expect(bell).toBeDefined();
    expect(bell!.items.some((i) => i.href === `/receiving/${po.id}` && i.label.includes(rr1.number))).toBe(true);
  });

  it("R3: a failing mailer never blocks the receiving; the failure is audited", async () => {
    const { po, lines, year } = await buildPo();
    setMailer({
      async send() {
        throw new Error("SMTP down");
      },
    });
    const rr = await postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "10" }]), receiver);
    const line = await db.purchaseOrderItem.findUnique({ where: { id: lines[0]!.id } });
    expect(String(line!.receivedQty)).toBe("10");
    const audit = await db.auditLog.findFirst({
      where: { entityType: "ReceivingReport", entityId: rr.id, action: "send_email" },
    });
    expect((audit!.after as { receivingEmail?: string }).receivingEmail).toBe("failed");
  });

  it("R4: voiding a receiving report sends no email and the bell drops it", async () => {
    const { po, lines, year } = await buildPo();
    const rr = await postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "10" }]), receiver);
    expect(sent.filter((m) => m.subject.includes(po.number)).length).toBeGreaterThan(0);
    sent.length = 0;
    await voidReceivingReport(rr.id, "Wrong count", admin);
    expect(sent.filter((m) => m.subject.includes(po.number))).toHaveLength(0);
    const sections = await getNotifications(admin);
    const bell = sections.find((s) => s.key === "goods-received");
    expect(bell?.items.some((i) => i.label.includes(rr.number)) ?? false).toBe(false);
  });

  it("R5: with the Settings toggle OFF, a receiving sends no email", async () => {
    const snap = await getSettingsSnapshot();
    const saved = await saveSettings({
      key: "features",
      value: { ...snap.settings.features, receivingEmailEnabled: false },
      userId: admin.id,
      baseVersionId: snap.versionId,
    });
    expect(saved.ok).toBe(true);
    try {
      const { po, lines, year } = await buildPo();
      await postReceivingReport(po.id, receipt(year, [{ lineId: lines[0]!.id, qty: "10" }]), receiver);
      expect(sent.filter((m) => m.subject.includes(po.number))).toHaveLength(0);
    } finally {
      const latest = await getSettingsSnapshot();
      await saveSettings({
        key: "features",
        value: { ...latest.settings.features, receivingEmailEnabled: true },
        userId: admin.id,
        baseVersionId: latest.versionId,
      });
    }
  });
});
