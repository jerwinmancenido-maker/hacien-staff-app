// SO guards (REQ-PLAN-AUDIT-001 A1–A3; A1 REVISED — looser rule, Jerwin
// direct 2026-11-10 17:17, final approval 17:22):
// inside updateSalesOrder, under the SO row lock —
//  A1: once any non-void billing exists, the BIR core is frozen for
//      everyone: no line removals, no withholding rate/ATC/pick changes
//      (the 2307 split uses the billing's stored breakdown). Qty/price
//      edits and line adds stay open under the price lock (Admin + typed
//      reason, audited). Each billing captures its own withholding
//      breakdown at record time (Billing.withholdingBreakdown), and the
//      2307 prefill splits from it — proven below: an allowed edit cannot
//      move an issued SI's prefill.
//  A2: contract price can never drop below the billed total.
//  A3: qty can never drop below the live ordered qty (PO not VOID, PO line
//      not removed); a line — or a lot whose component — is on a PO cannot
//      be removed.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { recordBilling, updateBilling, voidBilling } from "@/lib/services/billings";
import { withholdingCodePrefill } from "@/lib/services/collections";
import { approveQuote, convertQuoteToSalesOrder, createQuote } from "@/lib/services/quotes";
import { updateSalesOrder } from "@/lib/services/sales-orders";
import { getSettingsSnapshot } from "@/lib/settings";
import { snapshotList } from "@/lib/services/withholding";
import type { QuoteInput } from "@/lib/validation/quotes";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

const REASON = "Customer PO corrected it";

describe.skipIf(!env.hasDb)("SO guards (A1 revised billed-SO protections, A2/A3 floors)", () => {
  it("enforces the floors and the freeze", async () => {
    const admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
    const supplier = await makeSupplier();

    let invoiceSeq = 0;
    async function nextInvoice(): Promise<number> {
      if (invoiceSeq === 0) {
        const [maxBilling, maxSpoiled, maxClaim] = await Promise.all([
          db.billing.aggregate({ _max: { invoiceNo: true } }),
          db.spoiledBookletNumber.aggregate({ _max: { number: true }, where: { type: "SI" } }),
          db.bookletSerialClaim.aggregate({ _max: { number: true }, where: { type: "SI" } }),
        ]);
        const maxUsed = Math.max(
          900_000,
          Number(maxBilling._max.invoiceNo ?? 0),
          Number(maxSpoiled._max.number ?? 0),
          Number(maxClaim._max.number ?? 0),
        );
        invoiceSeq = maxUsed + Math.floor(Math.random() * 500) + 1;
      }

      for (let attempt = 0; attempt < 500; attempt++) {
        const candidate = ++invoiceSeq;
        const [takenBilling, spoiled, takenClaim] = await Promise.all([
          db.billing.findFirst({ where: { invoiceNo: candidate }, select: { id: true } }),
          db.spoiledBookletNumber.findFirst({ where: { type: "SI", number: candidate }, select: { id: true } }),
          db.bookletSerialClaim.findFirst({ where: { type: "SI", number: candidate }, select: { number: true } }),
        ]);
        if (!takenBilling && !spoiled && !takenClaim) {
          return candidate;
        }
      }
      throw new Error("Could not allocate unused SI number after 500 attempts");
    }

    async function openSo(year: number, items?: QuoteInput["items"], pick?: string[]) {
      const customer = await makeCustomer(pick ?? null);
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
        withholdingRate: i.withholdingRate != null ? i.withholdingRate.toFixed(4) : null,
        withholdingAtc: i.withholdingAtc,
        withholdingOverride: i.withholdingOverride,
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
      withholdingRate: string | null;
      withholdingAtc: string | null;
      withholdingOverride: boolean;
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

    // --- A1 (revised): billed SO — core frozen, the rest stays editable --
    {
      const year = await freshYear();
      const { so } = await openSo(year, undefined, ["GOODS_1", "SERVICES_2"]);
      const invoiceNo = await nextInvoice();
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

      // The billing captured its own withholding breakdown at record time.
      const billedRow = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
      expect(billedRow.withholdingBreakdown).not.toBeNull();
      const prefillBefore = await withholdingCodePrefill(db as never, billing.id);

      // Qty up on the unbilled portion: allowed for an admin with a reason,
      // and the reason lands in the audit row.
      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "12" } : i))),
        admin,
      );
      const afterQty = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(afterQty.contractPrice.toFixed(2)).toBe("644000.00");
      const auditRow = await db.auditLog.findFirst({
        where: { entityType: "SalesOrder", entityId: so.id, action: "update" },
        orderBy: { at: "desc" },
      });
      expect((auditRow?.after as { priceOverrideReason?: string } | null)?.priceOverrideReason).toBe(REASON);

      // The allowed edit did NOT move the issued SI's 2307 prefill.
      const prefillAfter = await withholdingCodePrefill(db as never, billing.id);
      expect(prefillAfter).toEqual(prefillBefore);

      // Adding a line: allowed.
      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => [
          ...items,
          { id: null, description: "Extra cable", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "1000", withholdingRate: null, withholdingAtc: null, withholdingOverride: false },
        ]),
        admin,
      );

      // Withholding change: refused for everyone while a billing is live.
      await expect(
        updateSalesOrder(
          so.id,
          await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, withholdingRate: "0.0200", withholdingAtc: "WI999", withholdingOverride: true } : i))),
          admin,
        ),
      ).rejects.toThrow(/Withholding can't change after a billing is issued/);

      // Line removal: refused while a billing is live.
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.filter((i) => i.id !== laptop.id)), admin),
      ).rejects.toThrow(/Lines can't be removed after a billing is issued/);

      // Notes-only edit is still allowed — including with the null-rate
      // line added above present (regression: the freeze loop once compared
      // the doc-snapshot-filled stored rate against the raw planned null
      // and refused plain re-saves).
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items, { notes: "Called the buyer" }), admin);

      // After voiding the billing, the withholding change passes.
      await voidBilling(billing.id, "Wrong amount encoded", admin);
      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, withholdingRate: "0.0200", withholdingAtc: "WI999", withholdingOverride: true } : i))),
        admin,
      );
    }

    // --- A2: total can never drop below the billed total -----------------
    {
      const year = await freshYear();
      const { so } = await openSo(year, undefined, ["GOODS_1", "SERVICES_2"]);
      const invoiceNo = await nextInvoice();
      await recordBilling(
        {
          salesOrderId: so.id,
          amount: "500000.00",
          invoiceNo,
          invoiceDate: new Date(Date.UTC(year, 2, 5)),
          dueDate: new Date(Date.UTC(year, 3, 4)),
          notes: null,
        },
        admin,
      );
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const laptop = rows[0]!;
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, unitPrice: "1000" } : i))), admin),
      ).rejects.toThrow(/below what is already billed/);
    }

    // --- A2 split (CTO ruling 2026-11-11): the floor binds money-moving
    // saves ONLY. Legacy state: billed 500,000, then the line price was
    // cut outside the service (pre-guard data) so the lines now sum to
    // 310,000 — already below billed.
    {
      const year = await freshYear();
      const { so } = await openSo(year, undefined, ["GOODS_1", "SERVICES_2"]);
      const invoiceNo = await nextInvoice();
      await recordBilling(
        { salesOrderId: so.id, amount: "500000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const laptop = rows[0]!;
      await db.salesOrderItem.update({ where: { id: laptop.id }, data: { unitPrice: "29000", total: "290000" } });
      await db.salesOrder.update({
        where: { id: so.id },
        data: { contractPrice: "310000.00", withholdingTotal: "3300.00", netReceived: "306700.00" },
      });
      // (1) A non-money save goes through despite being below billed.
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items, { notes: "Called the buyer" }), admin);
      // (2) A money-moving save that stays below billed is refused.
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "11" } : i))), admin),
      ).rejects.toThrow(/below what is already billed/);
    }

    // --- Bugbot @f8c58dc: stacked pick (GOV_PT) on a goods-only SO -------
    // The stored snapshot stacks GOV_PT_3 onto the whole base; the old
    // header-snapshot compare could never match the line-derived grouping
    // and refused every save after billing. Per-line freeze + the captured
    // breakdown carry A1 now, so plain edits pass and a line-rate change
    // is still refused.
    {
      const year = await freshYear();
      const govItems: QuoteInput["items"] = [
        { id: null, description: "Gov goods", kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "1000", withholdingRate: null, withholdingAtc: null, withholdingOverride: false } as never,
      ];
      const { so } = await openSo(year, govItems, ["GOODS_1", "GOV_PT_3"]);
      const invoiceNo = await nextInvoice();
      await recordBilling(
        { salesOrderId: so.id, amount: "500.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      // A plain notes save passes (the header compare is gone).
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items, { notes: "Gov order" }), admin);
      // A line withholding change is still refused.
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const line = rows[0]!;
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === line.id ? { ...i, withholdingRate: "0.0500", withholdingAtc: "WI999", withholdingOverride: true } : i))), admin),
      ).rejects.toThrow(/Withholding can't change after a billing is issued/);
    }

    // --- Bugbot @f8c58dc: a billing edit must not move the issued split --
    {
      const year = await freshYear();
      const { so } = await openSo(year, undefined, ["GOODS_1", "SERVICES_2"]);
      const invoiceNo = await nextInvoice();
      const billing = await recordBilling(
        { salesOrderId: so.id, amount: "10000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      const before = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
      const partsBefore = before.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(partsBefore.length).toBeGreaterThan(1);
      // The stored parts are the issue-time SHARES (they sum to the SO's
      // full withholding). The billing's expected withholding is pro-rata,
      // so after the SO edit + amount change the parts rescale to the NEW
      // expected — same rates, same shares, sum tracks the expected total
      // (it does NOT simply double, and it is never recaptured live).
      // An allowed SO edit (qty up) changes the live line mix.
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const laptop = rows[0]!;
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, qty: "12" } : i))), admin);
      // Editing the billing (double the amount) rescales the STORED parts —
      // same rates, same shares — instead of recapturing the new mix.
      await updateBilling(
        billing.id,
        { amount: "20000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
      const partsAfter = after.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(partsAfter.map((x) => x.rate)).toEqual(partsBefore.map((x) => x.rate));
      expect(partsAfter.map((x) => x.atcCode)).toEqual(partsBefore.map((x) => x.atcCode));
      // Shares preserved: each part's share of the whole is unchanged.
      const sumBefore = partsBefore.reduce((a, x) => a + Number(x.amount), 0);
      const sumAfter = partsAfter.reduce((a, x) => a + Number(x.amount), 0);
      partsAfter.forEach((x, i) => {
        expect(Number(x.amount) / sumAfter).toBeCloseTo(Number(partsBefore[i]!.amount) / sumBefore, 4);
      });
      // The parts stay on their own scale: the new sum is the old sum
      // scaled by the expected totals' ratio, and every part is positive.
      const ratio = Number(after.withholdingExpected) / Number(before.withholdingExpected);
      expect(sumAfter).toBeCloseTo(sumBefore * ratio, 1);
      partsAfter.forEach((x) => {
        expect(Number(x.amount)).toBeGreaterThan(0);
      });
    }

    // --- REQ-188 Test 1: Same-amount updateBilling after an allowed SO money edit -----
    // With a stored breakdown: expected must stay ₱100.00, not move to ₱66.67.
    // Setup: bill ₱10,000.00 on a ₱100,000.00 / ₱1,000.00 WH order, then grow the
    // contract to ₱150,000.00 with WH still ₱1,000.00, then save the billing at the
    // same ₱10,000.00 (notes/dates may change). Assert withholdingExpected stays
    // 100.00, ATCs/shares stay, and the parts are not recaptured from the live SO.
    {
      const year = await freshYear();
      const goodsItems: QuoteInput["items"] = [
        { id: null, description: "Base goods", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "1000", unitPrice: "100000", withholdingRate: null, withholdingAtc: null, withholdingOverride: false } as never,
      ];
      const { so } = await openSo(year, goodsItems, ["GOODS_1"]);
      const invoiceNo = await nextInvoice();
      const billing = await recordBilling(
        { salesOrderId: so.id, amount: "10000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      const billedRowBefore = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
      expect(billedRowBefore.withholdingExpected.toFixed(2)).toBe("100.00");
      const partsBefore = billedRowBefore.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(partsBefore.length).toBe(1);
      expect(partsBefore[0]!.rate).toBe("0.0100");

      // Grow contract to ₱150,000.00 with WH still ₱1,000.00 via an allowed Admin save
      // (adding an exempt line of ₱50,000.00 with 0% WH).
      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => [
          ...items,
          { id: null, description: "Exempt addon", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "50000", withholdingRate: "0.0000", withholdingAtc: null, withholdingOverride: true },
        ]),
        admin,
      );
      const soAfterGrow = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soAfterGrow.contractPrice.toFixed(2)).toBe("150000.00");
      expect(soAfterGrow.withholdingTotal.toFixed(2)).toBe("1000.00");

      // Save billing at the same ₱10,000.00 amount (e.g. notes change)
      await updateBilling(
        billing.id,
        { amount: "10000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: "Updated note" },
        admin,
      );

      const billedRowAfter = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
      // Must stay 100.00, not move to 66.67
      expect(billedRowAfter.withholdingExpected.toFixed(2)).toBe("100.00");
      const partsAfter = billedRowAfter.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(partsAfter).toEqual(partsBefore);
    }

    // --- REQ-188 Test 2: Billed stacked GOV_PT SO: freeze stored snapshot on edits -----
    // Goods line qty 2 × ₱1,000 = ₱2,000 with picks GOV_GOODS_1 + GOV_PT_3 →
    // header {WI640, WB080} / WH ₱80.00.
    // After a notes save and after an allowed Admin qty save, assert header ATCs
    // stay {WI640, WB080} and that a later recordBilling / captureWithholdingBreakdown
    // path still sees the stack, not a collapsed {WI640} / ₱20.00.
    // A notes-only save must also keep WH ₱80.00.
    {
      const year = await freshYear();
      const govItems: QuoteInput["items"] = [
        { id: null, description: "Gov goods", kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "1000", withholdingRate: null, withholdingAtc: null, withholdingOverride: false } as never,
      ];
      const { so } = await openSo(year, govItems, ["GOV_GOODS_1", "GOV_PT_3"]);
      const soInitial = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soInitial.withholdingTotal.toFixed(2)).toBe("80.00");
      const initialSnaps = snapshotList(soInitial.withholding);
      expect(initialSnaps.map((s) => s.atcCode)).toEqual(["WI640", "WB080"]);

      const invoiceNo1 = await nextInvoice();
      const b1 = await recordBilling(
        { salesOrderId: so.id, amount: "500.00", invoiceNo: invoiceNo1, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      const b1Row = await db.billing.findUniqueOrThrow({ where: { id: b1.id } });
      const b1Parts = b1Row.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(b1Parts.map((p) => p.atcCode)).toEqual(["WI640", "WB080"]);

      // Notes-only save: must keep both ATCs and ₱80.00
      await updateSalesOrder(so.id, await soInput(so.id, (items) => items, { notes: "Preserve stack test" }), admin);
      const soAfterNotes = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soAfterNotes.withholdingTotal.toFixed(2)).toBe("80.00");
      const snapsAfterNotes = snapshotList(soAfterNotes.withholding);
      expect(snapsAfterNotes.map((s) => s.atcCode)).toEqual(["WI640", "WB080"]);

      // Allowed Admin qty save: qty 2 -> 3 (contract grows to ₱3,000.00, WH to ₱120.00)
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const line = rows[0]!;
      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => items.map((i) => (i.id === line.id ? { ...i, qty: "3" } : i))),
        admin,
      );
      const soAfterQty = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soAfterQty.contractPrice.toFixed(2)).toBe("3000.00");
      expect(soAfterQty.withholdingTotal.toFixed(2)).toBe("120.00");
      const snapsAfterQty = snapshotList(soAfterQty.withholding);
      expect(snapsAfterQty.map((s) => s.atcCode)).toEqual(["WI640", "WB080"]);

      // Later recordBilling path still sees the stack, not a collapsed {WI640}
      const invoiceNo2 = await nextInvoice();
      const b2 = await recordBilling(
        { salesOrderId: so.id, amount: "500.00", invoiceNo: invoiceNo2, invoiceDate: new Date(Date.UTC(year, 2, 6)), dueDate: new Date(Date.UTC(year, 3, 5)), notes: null },
        admin,
      );
      const b2Row = await db.billing.findUniqueOrThrow({ where: { id: b2.id } });
      const b2Parts = b2Row.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(b2Parts.map((p) => p.atcCode)).toEqual(["WI640", "WB080"]);

      // Refuse re-apply and pick changes while billings exist
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items, { reapplyWithholding: true }), admin),
      ).rejects.toThrow(/Withholding can't change after a billing is issued/);
      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items, { withholdingCodes: ["GOV_GOODS_1"] }), admin),
      ).rejects.toThrow(/Withholding can't change after a billing is issued/);
    }

    // --- REQ-188 Test 3: Billed stacked GOV_PT + Admin exempt override add-on -----
    // Same setup as Test 2 (₱2,000.00 / ₱80.00, header {WI640, WB080}). After a
    // non-void billing, Admin adds an exempt override line (same pattern as
    // Test 1). Header must stay stacked, WH must stay ₱80.00 (goods base
    // unchanged), and a later recordBilling must still see {WI640, WB080}
    // with part amounts summing to so.withholdingTotal (not tax the exempt).
    {
      const year = await freshYear();
      const govItems: QuoteInput["items"] = [
        { id: null, description: "Gov goods", kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "1000", withholdingRate: null, withholdingAtc: null, withholdingOverride: false } as never,
      ];
      const { so } = await openSo(year, govItems, ["GOV_GOODS_1", "GOV_PT_3"]);
      const soInitial = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soInitial.withholdingTotal.toFixed(2)).toBe("80.00");
      expect(snapshotList(soInitial.withholding).map((s) => s.atcCode)).toEqual(["WI640", "WB080"]);

      const invoiceNo1 = await nextInvoice();
      await recordBilling(
        { salesOrderId: so.id, amount: "500.00", invoiceNo: invoiceNo1, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );

      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => [
          ...items,
          { id: null, description: "Exempt addon", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "1000", withholdingRate: "0.0000", withholdingAtc: null, withholdingOverride: true },
        ]),
        admin,
      );

      const soAfterExempt = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soAfterExempt.contractPrice.toFixed(2)).toBe("3000.00");
      expect(soAfterExempt.withholdingTotal.toFixed(2)).toBe("80.00");
      const snapsAfterExempt = snapshotList(soAfterExempt.withholding);
      expect(snapsAfterExempt.map((s) => s.atcCode)).toEqual(["WI640", "WB080"]);

      const invoiceNo2 = await nextInvoice();
      const b2 = await recordBilling(
        { salesOrderId: so.id, amount: "500.00", invoiceNo: invoiceNo2, invoiceDate: new Date(Date.UTC(year, 2, 6)), dueDate: new Date(Date.UTC(year, 3, 5)), notes: null },
        admin,
      );
      const b2Row = await db.billing.findUniqueOrThrow({ where: { id: b2.id } });
      // proRataWithholding(500, 3000, 80) = 13.33; stack must still drive the breakdown
      expect(b2Row.withholdingExpected.toFixed(2)).toBe("13.33");
      const b2Parts = b2Row.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(b2Parts.map((p) => p.atcCode)).toEqual(["WI640", "WB080"]);
      // Capture must not tax the exempt GOODS add-on (unfiltered → 30+90=120).
      expect(b2Parts.map((p) => ({ atcCode: p.atcCode, amount: p.amount }))).toEqual([
        { atcCode: "WI640", amount: "20.00" },
        { atcCode: "WB080", amount: "60.00" },
      ]);
      expect(b2Parts.reduce((a, p) => a + Number(p.amount), 0).toFixed(2)).toBe("80.00");
    }

    // --- REQ-188 Test 3b: same stack + SERVICES exempt override (2307 share) -----
    // Unfiltered capture would keep WI640 at ₱20 (goods-only) but inflate WB080
    // to ₱90 (3% of ₱3,000) → sum ₱110 and distort 2307 shares. Filtered
    // capture must stay WI640 ₱20 + WB080 ₱60 = ₱80.
    {
      const year = await freshYear();
      const govItems: QuoteInput["items"] = [
        { id: null, description: "Gov goods", kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "1000", withholdingRate: null, withholdingAtc: null, withholdingOverride: false } as never,
      ];
      const { so } = await openSo(year, govItems, ["GOV_GOODS_1", "GOV_PT_3"]);
      expect((await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).withholdingTotal.toFixed(2)).toBe("80.00");

      const invoiceNo1 = await nextInvoice();
      await recordBilling(
        { salesOrderId: so.id, amount: "500.00", invoiceNo: invoiceNo1, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );

      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => [
          ...items,
          { id: null, description: "Exempt service", kind: "SERVICES", qty: "1", unit: "hr", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "1000", withholdingRate: "0.0000", withholdingAtc: null, withholdingOverride: true },
        ]),
        admin,
      );

      const soAfterExempt = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soAfterExempt.contractPrice.toFixed(2)).toBe("3000.00");
      expect(soAfterExempt.withholdingTotal.toFixed(2)).toBe("80.00");

      const invoiceNo2 = await nextInvoice();
      const b2 = await recordBilling(
        { salesOrderId: so.id, amount: "500.00", invoiceNo: invoiceNo2, invoiceDate: new Date(Date.UTC(year, 2, 6)), dueDate: new Date(Date.UTC(year, 3, 5)), notes: null },
        admin,
      );
      const b2Row = await db.billing.findUniqueOrThrow({ where: { id: b2.id } });
      expect(b2Row.withholdingExpected.toFixed(2)).toBe("13.33");
      const b2Parts = b2Row.withholdingBreakdown as { rate: string; atcCode: string | null; amount: string }[];
      expect(b2Parts.map((p) => ({ atcCode: p.atcCode, amount: p.amount }))).toEqual([
        { atcCode: "WI640", amount: "20.00" },
        { atcCode: "WB080", amount: "60.00" },
      ]);
      expect(b2Parts.reduce((a, p) => a + Number(p.amount), 0).toFixed(2)).toBe("80.00");
    }

    // --- REQ-205 Bugbot HIGH: legacy null breakdown must not recapture -----
    // Pre-migration billings have withholdingBreakdown = null. After an
    // allowed SO money edit, a notes/amount save must keep the stored
    // withholdingExpected and leave breakdown null (never freeze the
    // post-edit live-SO split onto the issued SI). Collection prefill
    // stays on bare codes for the same reason.
    {
      const year = await freshYear();
      const goodsItems: QuoteInput["items"] = [
        { id: null, description: "Base goods", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "1000", unitPrice: "100000", withholdingRate: null, withholdingAtc: null, withholdingOverride: false } as never,
      ];
      const { so } = await openSo(year, goodsItems, ["GOODS_1"]);
      const invoiceNo = await nextInvoice();
      const billing = await recordBilling(
        { salesOrderId: so.id, amount: "10000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      // Simulate a pre-migration row: clear the captured breakdown.
      await db.billing.update({
        where: { id: billing.id },
        data: { withholdingBreakdown: Prisma.DbNull },
      });
      const before = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
      expect(before.withholdingBreakdown).toBeNull();
      expect(before.withholdingExpected.toFixed(2)).toBe("100.00");

      // Allowed SO money edit after issue (grow contract; WH base unchanged).
      await updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => [
          ...items,
          { id: null, description: "Exempt addon", kind: "GOODS", qty: "1", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "50000", withholdingRate: "0.0000", withholdingAtc: null, withholdingOverride: true },
        ]),
        admin,
      );
      const soAfter = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(soAfter.contractPrice.toFixed(2)).toBe("150000.00");

      // Notes-only billing save must not recapture from the edited SO.
      await updateBilling(
        billing.id,
        { amount: "10000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: "Legacy notes" },
        admin,
      );
      const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
      expect(after.withholdingExpected.toFixed(2)).toBe("100.00");
      expect(after.withholdingBreakdown).toBeNull();
      expect(after.notes).toBe("Legacy notes");

      // Prefill for a legacy null breakdown stays bare (no live-SO amounts).
      const prefill = await withholdingCodePrefill(db as never, billing.id);
      expect(prefill.every((p) => p.amount === "")).toBe(true);
    }

    // --- REQ-205 Bugbot MEDIUM: null line rates + notes-only below billed --
    // beforePrices fills NULL rates from the doc snapshot; afterPrices must
    // do the same or salesOrderPricesChanged trips the A2 floor on a
    // notes-only save. Real price cuts below billed stay refused.
    {
      const year = await freshYear();
      const { so } = await openSo(year, undefined, ["GOODS_1", "SERVICES_2"]);
      const invoiceNo = await nextInvoice();
      await recordBilling(
        { salesOrderId: so.id, amount: "500000.00", invoiceNo, invoiceDate: new Date(Date.UTC(year, 2, 5)), dueDate: new Date(Date.UTC(year, 3, 4)), notes: null },
        admin,
      );
      const rows = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null }, orderBy: { sortOrder: "asc" } });
      const laptop = rows[0]!;
      // Legacy below-billed state + null line rates (pre-stamp rows).
      await db.salesOrderItem.update({ where: { id: laptop.id }, data: { unitPrice: "29000", total: "290000", withholdingRate: null, withholdingAtc: null } });
      await db.salesOrderItem.updateMany({
        where: { salesOrderId: so.id, id: { not: laptop.id }, removedAt: null },
        data: { withholdingRate: null, withholdingAtc: null },
      });
      await db.salesOrder.update({
        where: { id: so.id },
        data: { contractPrice: "310000.00", withholdingTotal: "3300.00", netReceived: "306700.00" },
      });

      await updateSalesOrder(so.id, await soInput(so.id, (items) => items, { notes: "Null-rate notes save" }), admin);
      const afterNotes = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(afterNotes.notes).toBe("Null-rate notes save");
      expect(afterNotes.contractPrice.toFixed(2)).toBe("310000.00");

      await expect(
        updateSalesOrder(so.id, await soInput(so.id, (items) => items.map((i) => (i.id === laptop.id ? { ...i, unitPrice: "1000" } : i))), admin),
      ).rejects.toThrow(/below what is already billed/);
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
