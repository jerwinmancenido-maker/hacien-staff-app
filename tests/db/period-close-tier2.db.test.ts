// Phase 4 #10 step 3: Tier 2 period guards (convert / update / void
// sales order) + the admin-delete guards (deleteSalesOrder /
// deleteBilling / deleteCollection; deleteQuote deliberately
// UNGUARDED) against MySQL 8 (TEST_DATABASE_URL).
//
// Same pattern as the Tier 1 suite: each test closes a distinct month,
// the path succeeds while the month is open, closePeriod (real service,
// Admin actor) closes it, the same call then rejects with the
// closed-period message ("is closed"), and an open-month control still
// works. PeriodLock rows are REOPENED in afterAll / pre-cleaned in
// beforeAll — the app's no-delete extension forbids deleteMany.
//
// Note on updateSalesOrder: its input carries no date and the update
// never writes `date`, so the old and new period are the same stored
// date — the guard checks before.date, which covers both directions
// (there is no API path that moves an SO between months).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { recordBilling, voidBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection } from "@/lib/services/collections";
import { deleteBilling, deleteCollection, deleteQuote, deleteSalesOrder } from "@/lib/services/document-delete";
import { closePeriod, reopenPeriod } from "@/lib/services/period-close";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { updateSalesOrder, voidSalesOrder } from "@/lib/services/sales-orders";
import { customerDeliveryAddressId, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const plusDays = (date: Date, n: number) => new Date(date.getTime() + n * 86_400_000);

/** Every month this file closes — cleaned up so reruns start open. */
const CLOSED_MONTHS = ["2023-02", "2023-04", "2023-06", "2023-08", "2023-10", "2023-12", "2024-02"];

describe.skipIf(!env.hasDb)("period close Tier 2 + admin deletes (MySQL)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-period-close2-uploads-"));
    admin = await makeUser("costs");
    await reopenAll();
  });

  /** Reopen every month this file closed (no hard deletes in this app). */
  async function reopenAll() {
    for (const ym of CLOSED_MONTHS) {
      try {
        await reopenPeriod(ym, "Test cleanup — reopen after period-close suite", admin);
      } catch {
        // Not closed (test failed before closing, or a rerun pre-clean) — fine.
      }
    }
  }

  afterAll(async () => {
    await reopenAll();
    await db.$disconnect();
  });

  let invoiceSeq = 910_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  /** Parallel suites can republish settings with the default 1–500 booklet. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet period close 2" };
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

  async function makeApprovedQuote() {
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: d(2023, 1, 15),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: supplier.id, supplierUnitCost: "80000", unitPrice: "100000" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    return { customer, quote: q, deliveryAddressId };
  }

  async function makeSo(soDate: Date) {
    const { customer, quote, deliveryAddressId } = await makeApprovedQuote();
    const so = await convertQuoteToSalesOrder(quote.id, { buyerPoNo: `B-PC2-${tag()}`, deliveryAddressId }, admin, { date: soDate });
    return { customer, quote, so };
  }

  async function soEditInput(soId: string, notes: string) {
    const so = await db.salesOrder.findUniqueOrThrow({
      where: { id: soId },
      include: { items: { where: { removedAt: null } } },
    });
    return {
      contactId: so.contactId,
      buyerPoNo: so.buyerPoNo,
      buyerPoDate: so.buyerPoDate ?? undefined,
      deliveryAddress: so.deliveryAddress,
      terms: so.terms,
      notes,
      items: so.items.map((i) => ({
        id: i.id,
        description: i.description,
        kind: i.kind,
        qty: Number(i.qty).toFixed(2),
        unit: i.unit,
        unitPrice: Number(i.unitPrice).toFixed(2),
        supplierId: i.supplierId,
        supplierUnitCost: Number(i.supplierUnitCost).toFixed(2),
        withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
        withholdingAtc: i.withholdingAtc,
        withholdingOverride: i.withholdingOverride,
      })),
    };
  }

  // 16 — convertQuoteToSalesOrder: the new SO's date (opts.date)
  it("convertQuoteToSalesOrder refuses an SO date in a closed month; an open month still converts", async () => {
    const first = await makeApprovedQuote();
    const so1 = await convertQuoteToSalesOrder(first.quote.id, { buyerPoNo: "B-PC2", deliveryAddressId: first.deliveryAddressId }, admin, {
      date: d(2023, 2, 10),
    });
    expect(so1.date.toISOString().slice(0, 10)).toBe("2023-02-10");
    await closePeriod("2023-02", admin);

    const second = await makeApprovedQuote();
    await expect(
      convertQuoteToSalesOrder(second.quote.id, { buyerPoNo: "B-PC2", deliveryAddressId: second.deliveryAddressId }, admin, {
        date: d(2023, 2, 15),
      }),
    ).rejects.toThrow(/is closed/);
    expect(await db.salesOrder.count({ where: { quoteId: second.quote.id } })).toBe(0);
    expect((await db.quote.findUniqueOrThrow({ where: { id: second.quote.id } })).status).not.toBe("WON");

    const third = await makeApprovedQuote();
    const so3 = await convertQuoteToSalesOrder(third.quote.id, { buyerPoNo: "B-PC2", deliveryAddressId: third.deliveryAddressId }, admin, {
      date: d(2023, 3, 10),
    });
    expect(so3.id).toBeTruthy();
  });

  // 17 — updateSalesOrder: OLD + NEW date (same stored date — see header)
  it("updateSalesOrder refuses an SO dated in a closed month; an open-month SO still edits", async () => {
    const closed = await makeSo(d(2023, 4, 10));
    const open = await makeSo(d(2023, 5, 10));
    // Both months open: the edit lands.
    const edited = await updateSalesOrder(open.so.id, await soEditInput(open.so.id, "PC2 open edit"), admin);
    expect(edited.notes).toBe("PC2 open edit");
    await closePeriod("2023-04", admin);
    // The SO's own month is closed (old == new date): refused, unchanged.
    await expect(updateSalesOrder(closed.so.id, await soEditInput(closed.so.id, "PC2 closed edit"), admin)).rejects.toThrow(/is closed/);
    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: closed.so.id } })).notes).not.toBe("PC2 closed edit");
    // An SO dated in an open month still edits after the close.
    const edited2 = await updateSalesOrder(open.so.id, await soEditInput(open.so.id, "PC2 open edit 2"), admin);
    expect(edited2.notes).toBe("PC2 open edit 2");
  });

  // 18 — voidSalesOrder: the SO's date
  it("voidSalesOrder refuses an SO dated in a closed month", async () => {
    const { so } = await makeSo(d(2023, 6, 10));
    await closePeriod("2023-06", admin);
    await expect(voidSalesOrder(so.id, "Wrong order — reverse", admin)).rejects.toThrow(/is closed/);
    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("OPEN");
    const other = await makeSo(d(2023, 7, 10));
    const voided = await voidSalesOrder(other.so.id, "Wrong order — reverse", admin);
    expect(voided.status).toBe("VOID");
  });

  // 29 — deleteSalesOrder: refuse when the SO date is closed
  it("deleteSalesOrder refuses a void SO dated in a closed month; an open-month void SO deletes", async () => {
    const { so } = await makeSo(d(2023, 8, 10));
    await voidSalesOrder(so.id, "Entered in error", admin);
    await closePeriod("2023-08", admin);
    await expect(deleteSalesOrder(so.id, "Entered in error", admin)).rejects.toThrow(/is closed/);
    expect(await db.salesOrder.findUnique({ where: { id: so.id } })).not.toBeNull();

    const other = await makeSo(d(2023, 9, 10));
    await voidSalesOrder(other.so.id, "Entered in error", admin);
    await deleteSalesOrder(other.so.id, "Entered in error", admin);
    expect(await db.salesOrder.findUnique({ where: { id: other.so.id } })).toBeNull();
  });

  // 27 — deleteBilling: refuse when invoiceDate is closed
  it("deleteBilling refuses a void billing dated in a closed month; an open-month void billing deletes", async () => {
    await ensureWideBooklet();
    const a = await makeSo(d(2023, 10, 2));
    const billing = await recordBilling(
      { salesOrderId: a.so.id, amount: "1000.00", invoiceNo: nextInvoice(), invoiceDate: d(2023, 10, 10), dueDate: plusDays(d(2023, 10, 10), 30), notes: null },
      admin,
    );
    await voidBilling(billing.id, "Entered in error", admin);
    await closePeriod("2023-10", admin);
    await expect(deleteBilling(billing.id, "Entered in error", admin)).rejects.toThrow(/is closed/);
    expect(await db.billing.findUnique({ where: { id: billing.id } })).not.toBeNull();

    const b = await makeSo(d(2023, 11, 2));
    const billing2 = await recordBilling(
      { salesOrderId: b.so.id, amount: "1000.00", invoiceNo: nextInvoice(), invoiceDate: d(2023, 11, 10), dueDate: plusDays(d(2023, 11, 10), 30), notes: null },
      admin,
    );
    await voidBilling(billing2.id, "Entered in error", admin);
    await deleteBilling(billing2.id, "Entered in error", admin);
    expect(await db.billing.findUnique({ where: { id: billing2.id } })).toBeNull();
  });

  // 28 — deleteCollection: refuse when the collection date is closed
  it("deleteCollection refuses a void collection dated in a closed month; an open-month void collection deletes", async () => {
    const customer = await makeCustomer();
    const colInput = (date: Date) => ({
      customerId: customer.id,
      date,
      method: "CASH" as const,
      reference: null as string | null,
      checkBank: null as string | null,
      checkDate: null as Date | null,
      receiptNo: null as string | null,
      amountReceived: "1000.00",
      notes: null as string | null,
      allocations: [] as never[],
    });
    const col = await recordCollection(colInput(d(2023, 12, 10)), admin);
    await voidCollection(col.id, "Entered in error", admin);
    await closePeriod("2023-12", admin);
    await expect(deleteCollection(col.id, "Entered in error", admin)).rejects.toThrow(/is closed/);
    expect(await db.collection.findUnique({ where: { id: col.id } })).not.toBeNull();

    const col2 = await recordCollection(colInput(d(2024, 1, 10)), admin);
    await voidCollection(col2.id, "Entered in error", admin);
    await deleteCollection(col2.id, "Entered in error", admin);
    expect(await db.collection.findUnique({ where: { id: col2.id } })).toBeNull();
  });

  // deleteQuote stays UNGUARDED (deliberate exclusion): a draft quote
  // dated in a closed month still deletes.
  it("deleteQuote is NOT guarded: a draft quote dated in a closed month still deletes", async () => {
    const customer = await makeCustomer();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: d(2024, 2, 15),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: "Goods", kind: "GOODS", qty: "1", unit: "lot", supplierId: null, supplierUnitCost: "0", unitPrice: "1000" },
        ],
      },
      admin,
    );
    await closePeriod("2024-02", admin);
    await deleteQuote(q.id, "Entered in error", admin);
    expect(await db.quote.findUnique({ where: { id: q.id } })).toBeNull();
  });
});
