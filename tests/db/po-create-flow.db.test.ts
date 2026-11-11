// Selection-first Create POs: qty cap, ₱0 confirm, supplier checks, grouping,
// one transaction, idempotency, no SO/quote write-back, audit snapshot.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { createPurchaseOrdersFromSalesOrder, voidPurchaseOrder } from "@/lib/services/purchase-orders";
import { getCreatePosPreview, getSoPurchasing } from "@/lib/purchasing/views";
import { arAgingSummary } from "@/lib/billing/views";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { freshYear, makeCustomer, makeSupplier, makeUser } from "./fixtures";

describe.skipIf(!env.hasDb)("selection-first create POs (MySQL)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function salesOrder(year: number) {
    const customer = await makeCustomer();
    const [a, b] = await Promise.all([makeSupplier(), makeSupplier()]);
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Laptop i5", kind: "GOODS", qty: "10", unit: "pc", supplierId: a.id, supplierUnitCost: "45000", unitPrice: "52000" },
          { id: null, description: "Mouse", kind: "GOODS", qty: "10", unit: "pc", supplierId: a.id, supplierUnitCost: "500", unitPrice: "800" },
          { id: null, description: "Printer", kind: "GOODS", qty: "2", unit: "unit", supplierId: b.id, supplierUnitCost: "12000.50", unitPrice: "15000" },
          { id: null, description: "USB drive", kind: "GOODS", qty: "4", unit: "pc", supplierId: null, supplierUnitCost: "0", unitPrice: "100" },
          {
            id: null,
            description: "Classroom kit",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "20000",
            isLot: true,
            components: [
              { id: null, itemId: null, description: "Whiteboard", qty: "5", unit: "pc", supplierId: a.id, unitCost: "3200" },
              { id: null, itemId: null, description: "Screen", qty: "2", unit: "pc", supplierId: b.id, unitCost: "8900" },
            ],
          },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "1 Example St", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-FLOW", deliveryAddressId: delivAddr.id }, admin, { date: new Date(Date.UTC(year, 2, 2)) });
    const items = await db.salesOrderItem.findMany({
      where: { salesOrderId: so.id, removedAt: null },
      orderBy: { sortOrder: "asc" },
      include: { components: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    return { customer, a, b, q, so, items };
  }

  const input = (year: number, rows: { key: string; supplierId: string; qty: string; confirmZero?: boolean }[], idempotencyKey = `flow-${year}-${rows.map((r) => r.key).join("-")}`.slice(0, 64)) => ({
    date: new Date(Date.UTC(year, 2, 3)),
    expectedDate: null,
    deliveryAddressText: null,
    supplierPicks: {},
    idempotencyKey,
    rows,
  });

  async function moneySnap(soId: string) {
    const so = await db.salesOrder.findUniqueOrThrow({
      where: { id: soId },
      include: {
        items: { orderBy: { sortOrder: "asc" }, include: { components: { orderBy: { sortOrder: "asc" } } } },
        quote: { include: { items: { orderBy: { sortOrder: "asc" }, include: { components: { orderBy: { sortOrder: "asc" } } } } } },
      },
    });
    return {
      supplierCost: so.supplierCost.toFixed(2),
      items: so.items.map((i) => ({
        qty: i.qty.toFixed(2),
        supplierId: i.supplierId,
        supplierUnitCost: i.supplierUnitCost.toFixed(2),
        description: i.description,
        components: i.components.map((c) => ({ qty: c.qty.toFixed(2), supplierId: c.supplierId, unitCost: c.unitCost.toFixed(2), description: c.description })),
      })),
      quoteItems: so.quote.items.map((i) => ({
        qty: i.qty.toFixed(2),
        supplierId: i.supplierId,
        supplierUnitCost: i.supplierUnitCost.toFixed(2),
        description: i.description,
        components: i.components.map((c) => ({ qty: c.qty.toFixed(2), supplierId: c.supplierId, unitCost: c.unitCost.toFixed(2), description: c.description })),
      })),
    };
  }

  it("caps qty at the live remainder, then orders what's left, and refuses a third bite", async () => {
    const year = await freshYear();
    const { so, a, items } = await salesOrder(year);
    const laptop = items[0]!;
    await expect(createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: laptop.id, supplierId: a.id, qty: "11" }]), admin)).rejects.toThrow(/left to order/);
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(0);

    const [first] = await createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: laptop.id, supplierId: a.id, qty: "4" }], `partial-a-${year}`), admin);
    expect(first!.status).toBe("DRAFT");
    expect(first!.items[0]!.qty.toFixed(2)).toBe("4.00");
    expect(first!.items[0]!.unitCost.toFixed(2)).toBe("45000.00");
    expect(first!.items[0]!.activeSalesOrderItemId).toBe(laptop.id);
    expect(first!.items[0]!.salesOrderItemId).toBe(laptop.id);

    await expect(createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: laptop.id, supplierId: a.id, qty: "7" }], `partial-b-${year}`), admin)).rejects.toThrow(/left to order/);
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(1);

    const [second] = await createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: laptop.id, supplierId: a.id, qty: "6" }], `partial-c-${year}`), admin);
    expect(second!.items[0]!.qty.toFixed(2)).toBe("6.00");
    expect(second!.items[0]!.salesOrderItemId).toBe(laptop.id);
    expect(second!.items[0]!.activeSalesOrderItemId).toBeNull();
    await expect(createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: laptop.id, supplierId: a.id, qty: "1" }], `partial-d-${year}`), admin)).rejects.toThrow(/fully ordered/);
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(2);
  });

  it("blocks a ₱0 cost until that line confirms it, and blocks a missing or inactive supplier", async () => {
    const year = await freshYear();
    const { so, b, items } = await salesOrder(year);
    const usb = items.find((i) => i.description === "USB drive")!;
    await expect(createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: usb.id, supplierId: "", qty: "4", confirmZero: true }]), admin)).rejects.toThrow(/supplier/i);
    await expect(createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: usb.id, supplierId: b.id, qty: "4" }]), admin)).rejects.toThrow(/₱0\.00/);
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(0);

    await db.supplier.update({ where: { id: b.id }, data: { active: false } });
    let inactive: unknown;
    try {
      await createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: usb.id, supplierId: b.id, qty: "4", confirmZero: true }], `dead-${year}`), admin);
    } catch (e) {
      inactive = e;
    }
    expect(inactive).toBeInstanceOf(DocRuleError);
    expect((inactive as DocRuleError).message).toMatch(/deactivated/);
    expect((inactive as DocRuleError).fields?.[`supplier:${usb.id}`]).toMatch(/no longer active/);
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(0);

    await db.supplier.update({ where: { id: b.id }, data: { active: true } });
    const [po] = await createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: usb.id, supplierId: b.id, qty: "4", confirmZero: true }], `zero-ok-${year}`), admin);
    expect(po!.supplierId).toBe(b.id);
    expect(po!.items[0]!.unitCost.toFixed(2)).toBe("0.00");
    expect(po!.status).toBe("DRAFT");
  });

  it("groups by the final supplier, keeps quote costs, writes the audit snapshot, and does not touch the SO or quote", async () => {
    const year = await freshYear();
    const { so, a, b, items } = await salesOrder(year);
    const laptop = items[0]!;
    const printer = items.find((i) => i.description === "Printer")!;
    const lot = items.find((i) => i.isLot)!;
    const board = lot.components[0]!;
    const screen = lot.components[1]!;
    const before = await moneySnap(so.id);
    const pos = await createPurchaseOrdersFromSalesOrder(
      so.id,
      input(
        year,
        [
          { key: laptop.id, supplierId: b.id, qty: "2" },
          { key: printer.id, supplierId: b.id, qty: "2" },
          { key: board.id, supplierId: a.id, qty: "5" },
          { key: screen.id, supplierId: b.id, qty: "2" },
        ],
        `group-${year}`,
      ),
      admin,
    );
    expect(pos).toHaveLength(2);
    const poB = pos.find((p) => p.supplierId === b.id)!;
    const poA = pos.find((p) => p.supplierId === a.id)!;
    expect(poB.items.map((i) => i.description).sort()).toEqual(["Laptop i5", "Printer", "Screen"]);
    expect(poB.items.find((i) => i.description === "Laptop i5")!.unitCost.toFixed(2)).toBe("45000.00");
    expect(poB.items.find((i) => i.description === "Printer")!.unitCost.toFixed(2)).toBe("12000.50");
    expect(poB.items.find((i) => i.description === "Screen")!.salesOrderItemComponentId).toBe(screen.id);
    expect(poA.items.map((i) => i.description)).toEqual(["Whiteboard"]);
    expect(poA.items[0]!.unitCost.toFixed(2)).toBe("3200.00");
    expect(poA.items[0]!.salesOrderItemId).toBe(lot.id);
    expect(await moneySnap(so.id)).toEqual(before);

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "SalesOrder", entityId: so.id, action: "update" }, orderBy: { at: "desc" } });
    const after = audit.after as {
      idempotencyKey?: string;
      draftsOnly?: boolean;
      purchaseOrderIds?: string[];
      supplierChoices?: { key: string; quoteSupplierId: string | null; supplierId: string; overridden: boolean; qty: string; unitCost: string }[];
    };
    expect(after.idempotencyKey).toBe(`group-${year}`);
    expect(after.draftsOnly).toBe(true);
    expect(after.purchaseOrderIds?.slice().sort()).toEqual(pos.map((p) => p.id).sort());
    expect(after.supplierChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: laptop.id, quoteSupplierId: a.id, supplierId: b.id, overridden: true, qty: "2.00", unitCost: "45000.00" }),
        expect.objectContaining({ key: printer.id, quoteSupplierId: b.id, supplierId: b.id, overridden: false, qty: "2.00", unitCost: "12000.50" }),
        expect.objectContaining({ key: screen.id, quoteSupplierId: b.id, supplierId: b.id, overridden: false, unitCost: "8900.00" }),
      ]),
    );
    const poAudit = await db.auditLog.findFirstOrThrow({ where: { entityType: "PurchaseOrder", entityId: poB.id, action: "create" } });
    const poAfter = poAudit.after as { supplierChoices?: { key: string }[]; draftsOnly?: boolean };
    expect(poAfter.draftsOnly).toBe(true);
    expect(poAfter.supplierChoices?.map((c) => c.key).sort()).toEqual([laptop.id, printer.id, screen.id].sort());
  });

  it("is all-or-nothing when one supplier is inactive, and a repeated idempotency key creates nothing extra", async () => {
    const year = await freshYear();
    const { so, a, b, items } = await salesOrder(year);
    const laptop = items[0]!;
    const printer = items.find((i) => i.description === "Printer")!;
    await db.supplier.update({ where: { id: b.id }, data: { active: false } });
    await expect(
      createPurchaseOrdersFromSalesOrder(
        so.id,
        input(
          year,
          [
            { key: laptop.id, supplierId: a.id, qty: "1" },
            { key: printer.id, supplierId: b.id, qty: "1" },
          ],
          `atomic-${year}`,
        ),
        admin,
      ),
    ).rejects.toThrow(/deactivated|no longer active/);
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "SalesOrder", entityId: so.id, action: "update" } })).toBe(0);

    await db.supplier.update({ where: { id: b.id }, data: { active: true } });
    const key = `idem-${year}-ok`;
    const first = await createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: laptop.id, supplierId: a.id, qty: "3" }], key), admin);
    const second = await createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: laptop.id, supplierId: b.id, qty: "9" }], key), admin);
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(1);
    expect(first[0]!.items[0]!.qty.toFixed(2)).toBe("3.00");
    expect(first[0]!.supplierId).toBe(a.id);
    const other = await salesOrder(await freshYear());
    await expect(createPurchaseOrdersFromSalesOrder(so.id, input(year, [{ key: other.items[0]!.id, supplierId: a.id, qty: "1" }], `other-${year}`), admin)).rejects.toThrow(/not on this sales order/);
    expect(await db.purchaseOrder.count({ where: { salesOrderId: so.id } })).toBe(1);
  });

  /** Every open line and lot component, at its full qty. */
  function coverRows(ctx: Awaited<ReturnType<typeof salesOrder>>) {
    const rows: { key: string; supplierId: string; qty: string; confirmZero?: boolean }[] = [];
    for (const item of ctx.items) {
      if (item.isLot) {
        for (const c of item.components) rows.push({ key: c.id, supplierId: c.supplierId ?? ctx.a.id, qty: c.qty.toFixed(2) });
      } else {
        rows.push({
          key: item.id,
          supplierId: item.supplierId ?? ctx.b.id,
          qty: item.qty.toFixed(2),
          confirmZero: item.supplierUnitCost.toFixed(2) === "0.00",
        });
      }
    }
    return rows;
  }

  it("keeps Create POs available for leftover qty and pre-fills that qty", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const laptop = ctx.items.find((i) => i.description === "Laptop i5")!;
    await createPurchaseOrdersFromSalesOrder(ctx.so.id, input(year, [{ key: laptop.id, supplierId: ctx.a.id, qty: "4" }], `menu-partial-${year}`), admin);
    const progress = await getSoPurchasing(ctx.so.id, admin);
    expect(progress.needsMorePo).toBe(true);
    expect(progress.ordered).toBeLessThan(progress.total);
    const preview = await getCreatePosPreview(ctx.so.id, admin);
    const row = preview?.lines.find((l) => l.id === laptop.id);
    expect(row?.orderedQty).toBe("4.00");
    expect(row?.remainingQty).toBe("6.00");
  });

  it("hides Create POs once every line's required qty is on a live PO", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    await createPurchaseOrdersFromSalesOrder(ctx.so.id, input(year, coverRows(ctx), `menu-full-${year}`), admin);
    const progress = await getSoPurchasing(ctx.so.id, admin);
    expect(progress.needsMorePo).toBe(false);
    expect(progress.ordered).toBe(progress.total);
    const preview = await getCreatePosPreview(ctx.so.id, admin);
    expect(preview?.lines.every((l) => (l.isLot ? l.components.every((c) => c.remainingQty === "0.00") : l.remainingQty === "0.00"))).toBe(true);
  });

  it("counts a voided PO as cancelled, so its qty can be ordered again", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const laptop = ctx.items.find((i) => i.description === "Laptop i5")!;
    const [po] = await createPurchaseOrdersFromSalesOrder(ctx.so.id, input(year, [{ key: laptop.id, supplierId: ctx.a.id, qty: "10" }], `menu-void-${year}`), admin);
    await voidPurchaseOrder(po!.id, "cancelled", admin);
    const progress = await getSoPurchasing(ctx.so.id, admin);
    expect(progress.needsMorePo).toBe(true);
    expect(progress.ordered).toBeLessThan(progress.total);
    const preview = await getCreatePosPreview(ctx.so.id, admin);
    const row = preview?.lines.find((l) => l.id === laptop.id);
    expect(row?.orderedQty).toBe("0.00");
    expect(row?.remainingQty).toBe("10.00");
  });
  it("finds the idempotency key even under 45 later SO update audits (no fixed scan window)", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const laptop = ctx.items.find((i) => i.description === "Laptop i5")!;
    const key = `window-key-${year}`;
    const first = await createPurchaseOrdersFromSalesOrder(ctx.so.id, input(year, [{ key: laptop.id, supplierId: ctx.a.id, qty: "3" }], key), admin);
    await db.auditLog.createMany({
      data: Array.from({ length: 45 }, () => ({ entityType: "SalesOrder", entityId: ctx.so.id, action: "update" as const, after: {} })),
    });
    const second = await createPurchaseOrdersFromSalesOrder(ctx.so.id, input(year, [{ key: laptop.id, supplierId: ctx.b.id, qty: "9" }], key), admin);
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
    expect(await db.purchaseOrder.count({ where: { salesOrderId: ctx.so.id } })).toBe(first.length);
  });

  async function allocateUnusedInvoiceNo(): Promise<number> {
    const [maxBilling, maxSpoiled] = await Promise.all([
      db.billing.aggregate({ _max: { invoiceNo: true } }),
      db.spoiledBookletNumber.aggregate({ _max: { number: true } }),
    ]);
    let candidate =
      Math.max(
        1_000_000,
        Number(maxBilling._max.invoiceNo ?? 0),
        Number(maxSpoiled._max.number ?? 0),
      ) +
      Math.floor(Math.random() * 500) +
      1;

    for (let attempt = 0; attempt < 50; attempt++, candidate++) {
      const [existingBilling, existingSpoiled] = await Promise.all([
        db.billing.findUnique({ where: { invoiceNo: candidate }, select: { id: true } }),
        db.spoiledBookletNumber.findFirst({
          where: { number: candidate },
          select: { id: true },
        }),
      ]);
      if (!existingBilling && !existingSpoiled) {
        return candidate;
      }
    }
    return candidate;
  }

  it("AR aging credit includes POSTED return credit memos net of applications, like customerCreditBalance", async () => {
    const year = await freshYear();
    const ctx = await salesOrder(year);
    const suffix = `${year}-${Date.now().toString(36)}`;
    const posted = await db.customerReturn.create({
      data: { number: `RET-AGING-${suffix}`, salesOrderId: ctx.so.id, returnDate: new Date(Date.UTC(year, 2, 3)), status: "POSTED", createdById: admin.id },
    });
    const credit = await db.customerCredit.create({
      data: { customerId: ctx.so.customerId, customerReturnId: posted.id, amount: "1000", createdById: admin.id },
    });
    let billing: Awaited<ReturnType<typeof db.billing.create>> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const invoiceNo = await allocateUnusedInvoiceNo();
      try {
        billing = await db.billing.create({
          data: {
            number: `BL-AGING-${suffix}-${attempt}`,
            salesOrderId: ctx.so.id,
            customerId: ctx.so.customerId,
            invoiceNo,
            invoiceDate: new Date(Date.UTC(year, 2, 3)),
            dueDate: new Date(Date.UTC(year, 3, 3)),
            amount: "250",
            netExpected: "250",
            createdById: admin.id,
            updatedById: admin.id,
          },
        });
        break;
      } catch (err: unknown) {
        const isUniqueError =
          (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") ||
          String(err).includes("Billing_invoiceNo_key");
        if (isUniqueError && attempt < 4) {
          continue;
        }
        throw err;
      }
    }
    if (!billing) throw new Error("Failed to create billing after retries");
    await db.customerCreditApplication.create({ data: { customerCreditId: credit.id, billingId: billing.id, cashApplied: "250" } });
    const draft = await db.customerReturn.create({
      data: { number: `RET-AGING-D-${suffix}`, salesOrderId: ctx.so.id, returnDate: new Date(Date.UTC(year, 2, 3)), status: "VOID", createdById: admin.id },
    });
    await db.customerCredit.create({ data: { customerId: ctx.so.customerId, customerReturnId: draft.id, amount: "500", createdById: admin.id } });
    const summary = await arAgingSummary();
    const row = summary.byCustomer.find((c) => c.customerId === ctx.so.customerId);
    expect(row?.credit).toBe("750.00");
  });
});

