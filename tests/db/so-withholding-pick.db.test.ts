// PR-2b — SO header withholding pick, service-level proof.
// The editor now sends withholdingCodes ONLY when the pick changed; these
// tests pin the save behaviour that design relies on:
//  1. An editor-shaped pick change (codes + re-derived lines) persists:
//     stored snapshot, line rates and totals all move together.
//  2. An untouched pick is OMITTED — a notes-only save changes nothing,
//     on billed orders too (the billed freeze must not trip).
//  3. A billed order still refuses a changed pick, snapshot untouched.
//  4. A per-line override survives a pick change.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { recordBilling } from "@/lib/services/billings";
import { approveQuote, convertQuoteToSalesOrder, createQuote } from "@/lib/services/quotes";
import { updateSalesOrder } from "@/lib/services/sales-orders";
import { getSettingsSnapshot } from "@/lib/settings";
import { snapshotList } from "@/lib/services/withholding";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

const REASON = "Customer confirmed the withholding";

describe.skipIf(!env.hasDb)("SO header withholding pick (PR-2b)", () => {
  it("applies, omits, freezes and preserves overrides exactly as the editor drives it", async () => {
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
        if (!takenBilling && !spoiled && !takenClaim) return candidate;
      }
      throw new Error("Could not allocate unused SI number after 500 attempts");
    }

    async function openSo(year: number, pick?: string[]) {
      const customer = await makeCustomer(pick ?? null);
      const quote = await createQuote(quoteInput(customer.id, year, {}, supplier.id), admin);
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

    async function soInput(
      soId: string,
      edit: (items: Item[]) => Item[],
      extra: Record<string, unknown> = {},
      reason: string | null = REASON,
    ) {
      const so = await db.salesOrder.findUniqueOrThrow({ where: { id: soId } });
      const rows = await db.salesOrderItem.findMany({
        where: { salesOrderId: soId, removedAt: null },
        orderBy: { sortOrder: "asc" },
      });
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
        ...(reason ? { priceOverrideReason: reason } : {}),
        items: edit(items),
        ...extra,
      } as never;
    }

    async function stored(soId: string) {
      const so = await db.salesOrder.findUniqueOrThrow({ where: { id: soId } });
      const rows = await db.salesOrderItem.findMany({
        where: { salesOrderId: soId, removedAt: null },
        orderBy: { sortOrder: "asc" },
      });
      return {
        codes: snapshotList(so.withholding).map((w) => w.code).sort(),
        withholdingTotal: so.withholdingTotal.toFixed(2),
        rows,
      };
    }

    // Reference: what GOV_SERVICES_2 puts on a services line.
    const year0 = await freshYear();
    const { so: refSo } = await openSo(year0, ["GOV_SERVICES_2"]);
    const refRows = (await stored(refSo.id)).rows;
    const refSvc = refRows.find((r) => r.kind === "SERVICES")!;
    const svcRate = refSvc.withholdingRate!.toFixed(4);
    const svcAtc = refSvc.withholdingAtc;
    expect(svcRate).toBe("0.0200");

    // --- 1. Editor-shaped pick change on an unbilled SO ----------------
    const year1 = await freshYear();
    const { so } = await openSo(year1, ["GOV_GOODS_1"]);
    const before1 = await stored(so.id);
    expect(before1.codes).toEqual(["GOV_GOODS_1"]);
    expect(before1.withholdingTotal).toBe("5200.00"); // goods 520,000 × 1%

    await updateSalesOrder(
      so.id,
      await soInput(
        so.id,
        (items) =>
          items.map((i) =>
            i.kind === "SERVICES" ? { ...i, withholdingRate: svcRate, withholdingAtc: svcAtc } : i,
          ),
        { withholdingCodes: ["GOV_GOODS_1", "GOV_SERVICES_2"] },
      ),
      admin,
    );
    const after1 = await stored(so.id);
    expect(after1.codes).toEqual(["GOV_GOODS_1", "GOV_SERVICES_2"]);
    expect(after1.rows.find((r) => r.kind === "SERVICES")!.withholdingRate!.toFixed(4)).toBe("0.0200");
    expect(after1.withholdingTotal).toBe("5600.00"); // + services 20,000 × 2%

    // --- 2. Untouched pick omitted: notes-only save changes nothing ----
    await updateSalesOrder(
      so.id,
      await soInput(so.id, (items) => items, { notes: "pick untouched" }, null),
      admin,
    );
    const after2 = await stored(so.id);
    expect(after2.codes).toEqual(["GOV_GOODS_1", "GOV_SERVICES_2"]);
    expect(after2.withholdingTotal).toBe("5600.00");

    // --- 3. Billed: omitted pick saves fine; changed pick refused ------
    const invoiceNo = await nextInvoice();
    await recordBilling(
      {
        salesOrderId: so.id,
        amount: "10000.00",
        invoiceNo,
        invoiceDate: new Date(Date.UTC(year1, 2, 5)),
        dueDate: new Date(Date.UTC(year1, 3, 4)),
        notes: null,
      },
      admin,
    );
    await updateSalesOrder(
      so.id,
      await soInput(so.id, (items) => items, { notes: "billed, pick untouched" }, null),
      admin,
    );
    await expect(
      updateSalesOrder(
        so.id,
        await soInput(so.id, (items) => items, { withholdingCodes: ["GOV_GOODS_1"] }),
        admin,
      ),
    ).rejects.toThrow(/Withholding can't change after a billing is issued/);
    const after3 = await stored(so.id);
    expect(after3.codes).toEqual(["GOV_GOODS_1", "GOV_SERVICES_2"]);
    expect(after3.withholdingTotal).toBe("5600.00");

    // --- 4. A per-line override survives a pick change ------------------
    const year2 = await freshYear();
    const { so: so2 } = await openSo(year2, ["GOV_GOODS_1", "GOV_SERVICES_2"]);
    // Make the services line a deliberate exempt override first.
    await updateSalesOrder(
      so2.id,
      await soInput(so2.id, (items) =>
        items.map((i) =>
          i.kind === "SERVICES" ? { ...i, withholdingRate: "0.0000", withholdingAtc: null, withholdingOverride: true } : i,
        ),
      ),
      admin,
    );
    // Now drop GOV_SERVICES_2 from the pick (editor-shaped: override line
    // is submitted unchanged, exactly as applyPickDefaults leaves it).
    await updateSalesOrder(
      so2.id,
      await soInput(so2.id, (items) => items, { withholdingCodes: ["GOV_GOODS_1"] }),
      admin,
    );
    const after4 = await stored(so2.id);
    const svc2 = after4.rows.find((r) => r.kind === "SERVICES")!;
    expect(svc2.withholdingOverride).toBe(true);
    expect(svc2.withholdingRate!.toFixed(4)).toBe("0.0000");
    expect(after4.codes).toEqual(["GOV_GOODS_1"]);
    expect(after4.withholdingTotal).toBe("5200.00");

    // --- 5. A stacked pick round-trips (Bugbot finding on PR #208) ------
    // GOV_PT applies on top of the goods rate, so the goods line stores a
    // combined 4% with no single ATC. Rebuilding the stored snapshot from
    // the lines would collapse the stack into a LINE_* summary code; an
    // untouched save must keep the stored pick exactly.
    const year3 = await freshYear();
    const { so: so3 } = await openSo(year3, ["GOV_GOODS_1", "GOV_PT_3"]);
    const before5 = await stored(so3.id);
    expect(before5.codes).toEqual(["GOV_GOODS_1", "GOV_PT_3"]);
    expect(before5.withholdingTotal).toBe("21400.00"); // goods 520,000×1% + whole 540,000×3%

    await updateSalesOrder(
      so3.id,
      await soInput(so3.id, (items) => items, { notes: "stack untouched" }, null),
      admin,
    );
    const after5 = await stored(so3.id);
    expect(after5.codes).toEqual(["GOV_GOODS_1", "GOV_PT_3"]);
    expect(after5.withholdingTotal).toBe("21400.00");

    // And a pick change stores the new pick itself, not a line summary.
    await updateSalesOrder(
      so3.id,
      await soInput(
        so3.id,
        (items) => items.map((i) => ({ ...i, withholdingRate: "0.0300", withholdingAtc: "WB080" })),
        { withholdingCodes: ["GOV_PT_3"] },
      ),
      admin,
    );
    const after6 = await stored(so3.id);
    expect(after6.codes).toEqual(["GOV_PT_3"]);
    expect(after6.withholdingTotal).toBe("16200.00"); // whole 540,000 × 3%
  });
});

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet SO withholding pick" };
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
