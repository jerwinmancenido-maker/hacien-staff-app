// SO guards (REQ-PLAN-AUDIT-001 A1–A3; owner-approved 2026-11-10):
// inside updateSalesOrder, under the SO row lock —
//  A1: once any non-void billing exists, price/qty/kind/WH/add/remove are
//      refused at SO level (billings have no lines; the 2307 split reads
//      the live SO). Notes/terms and cost/supplier-only edits stay open.
//  A2: contract price can never drop below the billed total (behind A1).
//  A3: qty can never drop below the live ordered qty (PO not VOID, PO line
//      not removed); a line — or a lot whose component — is on a PO cannot
//      be removed.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { approveQuote, convertQuoteToSalesOrder, createQuote } from "@/lib/services/quotes";
import { updateSalesOrder } from "@/lib/services/sales-orders";
import { getSettingsSnapshot } from "@/lib/settings";
import type { QuoteInput } from "@/lib/validation/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

const REASON = "Customer PO corrected it";

describe.skipIf(!env.hasDb)("SO guards (A1 billing freeze, A3 ordered floor)", () => {
  it("enforces the floors and the freeze", async () => {
    const admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
    const supplier = await makeSupplier();

    async function openSo(year: number, items?: QuoteInput["items"]) {
      const customer = await makeCustomer();
      const quote = await createQuote(
        quoteInput(customer.id, year, items ? { items } : {}, supplier.id),
        admin,
      );
      await approveQuote(quote.id, admin);
      const deliveryAddressId = await customerDeliveryAddressId(customer.id);
      const so = await convertQuoteToSalesOrder(
        quote.id,
        { buyerPoNo: `B-${tag()}`, deliveryAddressId },
        admin,
        { date: new Date(Date.UTC(year, 2, 2)) },
      );
      return { customer, so };
    }

    async function soInput(soId: string, edit: (items: Item[]) => Item[], extra: Record<string, unknown> = {}) {
      const so = await db.salesOrder.findUniqueOrThrow({ where: { id: soId } });
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: soId, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const items: Item[] = rows.map((i) => ({
        id: i.id,
        description: i.description,
        kind: i.kind,
        qty: i.qty.toFixed(2),
        unit: i.unit,
        supplierId: i.supplierId,
        supplierUnitCost: i.supplierUnitCost.toFixed(2),
        unitPrice: i.unitPrice.toFixed(2),
      }));
      return {
        contactId: so.contactId,
        buyerPoNo: so.buyerPoNo,
        buyerPoDate: null,
        deliveryAddress: so.deliveryAddress,
        terms: so.terms,
        notes: so.notes,
        priceOverrideReason: REASON,
        items: edit(items),
        ...extra,
      } as never;
    }

    type Item = {
      id: string | null;
      description: string;
      kind: string;
      qty: string;
      unit: string;
      supplierId: string | null;
      supplierUnitCost: string;
      unitPrice: string;
    };

    async function linkPo(soId: string, lineId: string, qty: string, opts: { componentId?: string; voided?: boolean } = {}) {
      const so = await db.salesOrder.findUniqueOrThrow({ where: { id: soId } });
      const po = await db.purchaseOrder.create({
        data: {
          number: `PO-${tag()}`,
          supplierId: supplier.id,
          salesOrderId: soId,
          status: opts.voided ? "VOID" : "DRAFT",
          date: new Date(Date.UTC(2026, 2, 3)),
          settingsVersionId: so.settingsVersionId,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
      await db.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id,
          salesOrderItemId: opts.componentId ? null : lineId,
          activeSalesOrderItemId: opts.componentId || opts.voided ? null : lineId,
          salesOrderItemComponentId: opts.componentId ?? null,
          activeSalesOrderItemComponentId: opts.componentId && !opts.voided ? opts.componentId : null,
          sortOrder: 0,
          description: "linked line",
          kind: "GOODS",
          qty,
          unit: "pc",
          unitCost: "45000",
          total: "180000",
        },
      });
      return po;
    }

    // --- A3: qty floor -------------------------------------------------
    {
      const year = await freshYear();
      const { so } = await openSo(year);
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const laptop = rows[0]!;
      await linkPo(so.id, laptop.id, "4");
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "3" } : i))), admin),
      ).rejects.toThrow(/already on a purchase order/);
      // Exactly the ordered qty is allowed.
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "4" } : i))), admin);
      // Removing a line that is on a PO is refused.
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.filter((i) => i.id !== laptop.id)), admin),
      ).rejects.toThrow(/already on a purchase order/);
    }

    // --- A3: a VOID PO does not count ----------------------------------
    {
      const year = await freshYear();
      const { so } = await openSo(year);
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const laptop = rows[0]!;
      await linkPo(so.id, laptop.id, "4", { voided: true });
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "3" } : i))), admin);
    }

    // --- A3: a lot whose component is on a PO cannot be removed --------
    {
      const year = await freshYear();
      const supB = await makeSupplier();
      const { so } = await openSo(year, [
        {
          id: null,
          description: "ICT lot",
          kind: "SERVICES",
          qty: "1",
          unit: "lot",
          supplierId: null,
          supplierUnitCost: "0",
          unitPrice: "600000",
          isLot: true,
          components: [
            { id: null, itemId: null, description: "GCP subscription", qty: "1", unit: "lot", supplierId: supplier.id, unitCost: "300000" },
            { id: null, itemId: null, description: "Support hours", qty: "2", unit: "hour", supplierId: supB.id, unitCost: "50000" },
          ],
        },
        { id: null, description: "Laptop i5", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "45000", unitPrice: "52000" },
      ] as never);
      const lot = await db.salesOrderItem.findFirstOrThrow({
        where: { salesOrderId: so.id, isLot: true, removedAt: null },
        include: { components: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
      });
      await linkPo(so.id, lot.id, "1", { componentId: lot.components[0]!.id });
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.filter((i) => i.id !== lot.id)), admin),
      ).rejects.toThrow(/already on a purchase order/);
    }

    // --- A1: billing freeze --------------------------------------------
    {
      const year = await freshYear();
      const { so } = await openSo(year);
      const invoiceNo = 900_000 + Math.floor(Math.random() * 90_000);
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
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const laptop = rows[0]!;
      // Qty change refused, naming the SI.
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "9" } : i))), admin),
      ).rejects.toThrow(/already has SI no\./);
      // Price change refused (this is also the A2 floor in action: the
      // frozen edit can never push the total below the billed amount).
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, unitPrice: "1" } : i))), admin),
      ).rejects.toThrow(/already has SI no\./);
      // Notes-only edit is still allowed.
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items, { notes: "Called the buyer" }), admin);
      // After voiding the billing, the same qty edit passes (Admin + reason).
      await voidBilling(billing.id, "Wrong amount encoded", admin);
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "9" } : i))), admin);
    }
  });
});

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet SO guards" };
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
          createdById: adminId,
        },
      });
      return;
    } catch {
      // Unique version race with another suite — retry.
    }
  }
}
