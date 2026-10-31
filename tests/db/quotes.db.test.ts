// Quotes and sales orders against a real MySQL 8 database (TEST_DATABASE_URL).
// Run: TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/hacien_test npm test

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { HardDeleteError } from "@/lib/no-delete";
import { ForbiddenError } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { allocateDocNumber, ensureSeries, formatDocNumber } from "@/lib/documents/series";
import { DocRuleError } from "@/lib/documents/common";
import {
  buildQuoteEmailDraft,
  convertQuoteToSalesOrder,
  createQuote,
  markQuoteSent,
  updateQuote,
  voidQuote,
  type DocActor,
} from "@/lib/services/quotes";
import { updateSalesOrder, voidSalesOrder } from "@/lib/services/sales-orders";
import { listWithholdingRates, saveWithholdingRates, snapshotList } from "@/lib/services/withholding";
import { getQuotePrint, getQuoteView, getSalesOrderPrint, getSalesOrderView, listQuotesView } from "@/lib/quotes/views";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

/** Keys that must never reach a user without "Can see costs". */
const COST_KEYS = ["supplierId", "supplierName", "supplierUnitCost", "supplierTotal", "supplierCost", "margin", "netMargin", "netMarginPct"];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe.skipIf(!hasDb)("quotes and sales orders (MySQL)", () => {
  let costUser: DocActor;
  let staff: DocActor;
  let viewer: DocActor;
  let quotePrefix: string;
  let soPrefix: string;
  let padding: { quote: number; so: number };

  beforeAll(async () => {
    [costUser, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    const { settings } = await getSettingsSnapshot();
    quotePrefix = settings.numbering.quote.prefix;
    soPrefix = settings.numbering.salesOrder.prefix;
    padding = { quote: settings.numbering.quote.padding, so: settings.numbering.salesOrder.padding };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const qt = (year: number, n: number) => formatDocNumber({ prefix: quotePrefix, padding: padding.quote }, year, n);
  const so = (year: number, n: number) => formatDocNumber({ prefix: soPrefix, padding: padding.so }, year, n);

  // -------------------------------------------------------------------------
  describe("numbering", () => {
    it("gives 20 parallel creates 20 unique, consecutive numbers", async () => {
      const customer = await makeCustomer();
      const year = await freshYear();
      const created = await Promise.all(Array.from({ length: 20 }, () => createQuote(quoteInput(customer.id, year), costUser)));
      const numbers = created.map((q) => q.number).sort();
      expect(new Set(numbers).size).toBe(20);
      expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => qt(year, i + 1)));
    });

    it("keeps separate counters for quotes and sales orders", async () => {
      const customer = await makeCustomer();
      const year = await freshYear();
      const a = await createQuote(quoteInput(customer.id, year), costUser);
      const b = await createQuote(quoteInput(customer.id, year), costUser);
      const order = await convertQuoteToSalesOrder(a.id, { buyerPoNo: null, deliveryAddress: null }, costUser, { date: new Date(Date.UTC(year, 3, 1)) });
      const c = await createQuote(quoteInput(customer.id, year), costUser);
      expect([a.number, b.number, c.number]).toEqual([qt(year, 1), qt(year, 2), qt(year, 3)]);
      expect(order.number).toBe(so(year, 1));
    });

    it("restarts at 0001 in a new year", async () => {
      const customer = await makeCustomer();
      const year = await freshYear();
      const first = await createQuote(quoteInput(customer.id, year), costUser);
      const second = await createQuote(quoteInput(customer.id, year), costUser);
      const nextYear = await createQuote(quoteInput(customer.id, year + 1), costUser);
      expect(first.number).toBe(qt(year, 1));
      expect(second.number).toBe(qt(year, 2));
      expect(nextYear.number).toBe(qt(year + 1, 1));
    });

    it("never reissues a voided number", async () => {
      const customer = await makeCustomer();
      const year = await freshYear();
      const a = await createQuote(quoteInput(customer.id, year), costUser);
      await voidQuote(a.id, "Customer cancelled", costUser);
      const b = await createQuote(quoteInput(customer.id, year), costUser);
      expect(a.number).toBe(qt(year, 1));
      expect(b.number).toBe(qt(year, 2));
      expect((await db.quote.findUnique({ where: { id: a.id } }))?.number).toBe(qt(year, 1));
    });

    it("a failed transaction doesn't use up a number", async () => {
      const year = await freshYear();
      const format = { prefix: quotePrefix, padding: padding.quote, resetYearly: true };
      await ensureSeries(db, "QUOTE", year, format);
      await expect(
        db.$transaction(async (tx) => {
          await allocateDocNumber(tx, "QUOTE", year, format);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const n = await db.$transaction((tx) => allocateDocNumber(tx, "QUOTE", year, format));
      expect(n).toBe(qt(year, 1));
    });
  });

  // -------------------------------------------------------------------------
  describe("withholding", () => {
    it("defaults from customer type + line kinds and snapshots rate/ATC on each line", async () => {
      const customer = await makeCustomer([], "TOP_WITHHOLDING_AGENT");
      const supplier = await makeSupplier();
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), {}, supplier.id), costUser);
      expect(snapshotList(q.withholding).map((w) => [w.code, w.rate, w.atcCode])).toEqual([
        ["GOODS_1", "0.0100", "WI158"],
        ["SERVICES_2", "0.0200", "WI160"],
      ]);
      // Goods 520,000 + services 20,000 = 540,000. 1% of goods 5,200 + 2% of services 400.
      expect(q.contractPrice.toFixed(2)).toBe("540000.00");
      expect(q.withholdingTotal.toFixed(2)).toBe("5600.00");
      expect(q.netReceived.toFixed(2)).toBe("534400.00");
      expect(q.supplierCost.toFixed(2)).toBe("455000.00");
      const goods = q.items.find((i) => i.kind === "GOODS")!;
      const services = q.items.find((i) => i.kind === "SERVICES")!;
      expect(Number(goods.withholdingRate).toFixed(4)).toBe("0.0100");
      expect(goods.withholdingAtc).toBe("WI158");
      expect(goods.withholdingOverride).toBe(false);
      expect(Number(services.withholdingRate).toFixed(4)).toBe("0.0200");
      expect(services.withholdingAtc).toBe("WI160");
      expect(goods.supplierTotal.toFixed(2)).toBe("450000.00");
    });

    it("Government customer gets existing gov PT rate (not customer.defaultWithholding)", async () => {
      const customer = await makeCustomer(["GOODS_1"], "GOVERNMENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      expect(snapshotList(q.withholding).map((w) => w.code)).toEqual(["GOV_PT_3"]);
      // 3% of 540,000
      expect(q.withholdingTotal.toFixed(2)).toBe("16200.00");
      for (const i of q.items) {
        expect(Number(i.withholdingRate).toFixed(4)).toBe("0.0300");
        expect(i.withholdingAtc).toBe("WG010");
      }
    });

    it("saves a per-quote document override and per-line override flag", async () => {
      const customer = await makeCustomer([], "TOP_WITHHOLDING_AGENT");
      const created = await createQuote(quoteInput(customer.id, (await freshYear()), { withholdingCodes: ["SERVICES_2"] }), costUser);
      expect(snapshotList(created.withholding).map((w) => w.code)).toEqual(["SERVICES_2"]);
      const input = quoteInput(customer.id, 2026, {
        withholdingCodes: ["GOODS_1", "SERVICES_2"],
        items: [
          {
            id: null,
            description: "Laptop i5",
            kind: "GOODS",
            qty: "10",
            unit: "pc",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "52000",
            withholdingRate: "0.0150",
            withholdingAtc: "WI158",
            withholdingOverride: true,
          },
          {
            id: null,
            description: "Installation",
            kind: "SERVICES",
            qty: "1",
            unit: "lot",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "20000",
            withholdingRate: "0.0200",
            withholdingAtc: "WI160",
            withholdingOverride: false,
          },
        ],
      });
      const updated = await updateQuote(created.id, { ...input, date: created.date }, costUser);
      expect(snapshotList(updated.withholding).map((w) => w.code)).toEqual(["GOODS_1", "SERVICES_2"]);
      // Document math still uses document snapshot rates (1% + 2%), not the line override percent.
      expect(updated.withholdingTotal.toFixed(2)).toBe("5600.00");
      const goods = updated.items.find((i) => i.kind === "GOODS")!;
      expect(Number(goods.withholdingRate).toFixed(4)).toBe("0.0150");
      expect(goods.withholdingOverride).toBe(true);
    });

    it("a later customer type change does not alter existing lines, prints or EWT document snapshot", async () => {
      const customer = await makeCustomer([], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const beforeLines = q.items.map((i) => ({
        id: i.id,
        rate: Number(i.withholdingRate).toFixed(4),
        atc: i.withholdingAtc,
      }));
      const beforeDoc = snapshotList(q.withholding);

      await db.customer.update({ where: { id: customer.id }, data: { withholdingType: "GOVERNMENT" } });

      const view = await getQuoteView(q.id, costUser);
      expect(view?.withholding).toEqual(beforeDoc);
      expect(view?.totals.withholdingTotal).toBe(Number(q.withholdingTotal).toFixed(2));
      expect(
        view?.items.map((i) => ({ id: i.id, rate: i.withholdingRate, atc: i.withholdingAtc })),
      ).toEqual(beforeLines.map((l) => ({ id: l.id, rate: l.rate, atc: l.atc })));

      const print = await getQuotePrint(q.id);
      expect(print?.contractPrice).toBe("540000.00");
      // Print still has no withholding breakdown keys.
      expect(JSON.stringify(print)).not.toMatch(/withholdingTotal|WI158|WG010/);

      // Editing without re-apply keeps snapshotted line + document values.
      const input = quoteInput(customer.id, 2026, {
        withholdingCodes: beforeDoc.map((w) => w.code),
        items: q.items
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({
            id: i.id,
            description: i.description,
            kind: i.kind,
            qty: Number(i.qty).toFixed(2),
            unit: i.unit,
            unitPrice: Number(i.unitPrice).toFixed(2),
            supplierId: i.supplierId,
            supplierUnitCost: Number(i.supplierUnitCost).toFixed(2),
            withholdingRate: Number(i.withholdingRate).toFixed(4),
            withholdingAtc: i.withholdingAtc,
            withholdingOverride: i.withholdingOverride,
          })),
      });
      const edited = await updateQuote(q.id, { ...input, date: q.date }, costUser);
      expect(snapshotList(edited.withholding)).toEqual(beforeDoc);
      expect(edited.withholdingTotal.toFixed(2)).toBe(Number(q.withholdingTotal).toFixed(2));
    });

    it("Re-apply customer's withholding refreshes lines from the current type", async () => {
      const customer = await makeCustomer([], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      await db.customer.update({ where: { id: customer.id }, data: { withholdingType: "GOVERNMENT" } });
      const input = quoteInput(customer.id, 2026, {
        reapplyWithholding: true,
        items: q.items
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({
            id: i.id,
            description: i.description,
            kind: i.kind,
            qty: Number(i.qty).toFixed(2),
            unit: i.unit,
            unitPrice: Number(i.unitPrice).toFixed(2),
            supplierId: i.supplierId,
            supplierUnitCost: Number(i.supplierUnitCost).toFixed(2),
          })),
      });
      const reapplied = await updateQuote(q.id, { ...input, date: q.date }, costUser);
      expect(snapshotList(reapplied.withholding).map((w) => w.code)).toEqual(["GOV_PT_3"]);
      expect(reapplied.withholdingTotal.toFixed(2)).toBe("16200.00");
      for (const i of reapplied.items.filter((x) => !x.removedAt)) {
        expect(Number(i.withholdingRate).toFixed(4)).toBe("0.0300");
        expect(i.withholdingAtc).toBe("WG010");
        expect(i.withholdingOverride).toBe(false);
      }
    });

    it("a Settings rate change doesn't alter an existing quote's snapshotted document rates", async () => {
      const code = `T_${tag().toUpperCase()}`;
      const rowsNow = async () =>
        (await listWithholdingRates()).map((r) => ({
          id: r.id,
          code: r.code,
          label: r.label,
          lineKind: r.lineKind,
          atcCode: r.atcCode ?? "",
          ratePct: String(Number(r.rate) * 100),
          active: r.active,
          note: r.note ?? "",
        }));
      const save = async (rows: unknown) => {
        const { versionId } = await getSettingsSnapshot();
        const res = await saveWithholdingRates(rows, costUser.id, versionId);
        expect(res.ok).toBe(true);
      };
      await save([...(await rowsNow()), { code, label: "Test goods 1%", lineKind: "GOODS", atcCode: "WI158", ratePct: "1", active: true, note: "verify with BIR" }]);

      const customer = await makeCustomer([], "NONE");
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), { withholdingCodes: [code] }), costUser);
      expect(q.withholdingTotal.toFixed(2)).toBe("5200.00");

      await save((await rowsNow()).map((r) => (r.code === code ? { ...r, ratePct: "5" } : r)));
      expect(Number((await db.withholdingRate.findUnique({ where: { code } }))?.rate)).toBe(0.05);

      const view = await getQuoteView(q.id, costUser);
      expect(view?.withholding.map((w) => w.rate)).toEqual(["0.0100"]);
      expect(view?.totals.withholdingTotal).toBe("5200.00");
      const input = quoteInput(customer.id, 2026, { withholdingCodes: [code] });
      const edited = await updateQuote(q.id, { ...input, date: q.date }, costUser);
      expect(edited.withholdingTotal.toFixed(2)).toBe("5200.00");

      await save((await rowsNow()).map((r) => (r.code === code ? { ...r, active: false } : r)));
    });
  });

  // -------------------------------------------------------------------------
  describe("cost hiding", () => {
    it("quote and SO payloads for a non-cost user contain no cost or margin fields", async () => {
      const customer = await makeCustomer([], "TOP_WITHHOLDING_AGENT");
      const supplier = await makeSupplier();
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), { withholdingCodes: ["GOODS_1"] }, supplier.id), costUser);
      const order = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddress: null }, costUser);

      for (const user of [staff, viewer]) {
        const payloads = [
          await getQuoteView(q.id, user),
          (await listQuotesView({ q: customer.name }, user))[0],
          await getSalesOrderView(order.id, user),
        ];
        for (const p of payloads) {
          expect(p).toBeTruthy();
          const keys = keysDeep(p);
          for (const k of COST_KEYS) expect(keys.has(k), `${k} leaked`).toBe(false);
          expect(JSON.stringify(p)).not.toContain(supplier.name);
          expect(JSON.stringify(p)).not.toContain("45000.00");
        }
      }

      const full = await getQuoteView(q.id, costUser);
      expect(full?.totals.netMargin).toBe("79800.00"); // 540,000 − 5,200 − 455,000
      expect(full?.items[0]?.supplierName).toBe(supplier.name);
      expect((await listQuotesView({ q: customer.name }, costUser))[0]?.netMarginPct).toBe("14.78");
    });

    it("a non-cost user's edit keeps the existing costs", async () => {
      const customer = await makeCustomer();
      const supplier = await makeSupplier();
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), {}, supplier.id), costUser);
      const items = [...q.items].sort((a, b) => a.sortOrder - b.sortOrder);
      const input = quoteInput(customer.id, 2026);
      const edited = await updateQuote(
        q.id,
        {
          ...input,
          date: q.date,
          items: [
            // Tries to zero the cost: ignored for a non-cost user.
            { ...input.items[0]!, id: items[0]!.id, qty: "5", supplierId: null, supplierUnitCost: "0" },
            { id: null, description: "Cable", kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "100", unitPrice: "300" },
          ],
        },
        staff,
      );
      const laptop = edited.items.find((i) => i.id === items[0]!.id)!;
      expect(laptop.supplierId).toBe(supplier.id);
      expect(laptop.supplierUnitCost.toFixed(2)).toBe("45000.00");
      expect(laptop.supplierTotal.toFixed(2)).toBe("225000.00");
      const cable = edited.items.find((i) => i.description === "Cable")!;
      expect(cable.supplierId).toBeNull();
      expect(cable.supplierUnitCost.toFixed(2)).toBe("0.00");
      // The removed services line is kept, marked removed (never deleted).
      const removed = await db.quoteItem.findUnique({ where: { id: items[1]!.id } });
      expect(removed?.removedAt).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  describe("convert and void", () => {
    it("convert creates the SO with copied items, line rates/ATCs and marks the quote Won", async () => {
      const customer = await makeCustomer([], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      await markQuoteSent(q.id, costUser);
      const order = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "2026-118", deliveryAddress: null }, staff);
      expect(order.quoteId).toBe(q.id);
      expect(order.status).toBe("OPEN");
      expect(order.items).toHaveLength(2);
      expect(order.supplierCost.toFixed(2)).toBe("455000.00");
      expect(order.withholding).toEqual(q.withholding);
      expect(order.settingsVersionId).toBe(q.settingsVersionId);
      expect(order.deliveryAddress).toBe("Test address");
      const qLines = [...q.items].sort((a, b) => a.sortOrder - b.sortOrder);
      const soLines = [...order.items].sort((a, b) => a.sortOrder - b.sortOrder);
      expect(
        soLines.map((i) => ({
          kind: i.kind,
          rate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
          atc: i.withholdingAtc,
          override: i.withholdingOverride,
        })),
      ).toEqual(
        qLines.map((i) => ({
          kind: i.kind,
          rate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
          atc: i.withholdingAtc,
          override: i.withholdingOverride,
        })),
      );
      expect((await db.quote.findUnique({ where: { id: q.id } }))?.status).toBe("WON");
      await expect(convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, costUser)).rejects.toBeInstanceOf(DocRuleError);
    });

    it("convert is blocked on a void quote", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      await voidQuote(q.id, "Duplicate", costUser);
      await expect(convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, costUser)).rejects.toThrow(/void quote/);
      await expect(updateQuote(q.id, quoteInput(customer.id, 2026), costUser)).rejects.toBeInstanceOf(DocRuleError);
    });

    it("a Won quote with an open SO can't be voided; voiding the SO returns the quote to Sent", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const order = await convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, costUser);
      await expect(voidQuote(q.id, "Changed mind", costUser)).rejects.toThrow("Void the sales order first.");

      await voidSalesOrder(order.id, "Buyer cancelled the PO", staff);
      const after = await db.salesOrder.findUnique({ where: { id: order.id } });
      expect(after?.status).toBe("VOID");
      expect(after?.number).toBe(order.number);
      expect((await db.quote.findUnique({ where: { id: q.id } }))?.status).toBe("SENT");
      await expect(updateSalesOrder(order.id, { buyerPoNo: null, contactId: null, terms: null, notes: null, deliveryAddress: null, items: quoteInput(customer.id, 2026).items }, costUser)).rejects.toThrow(/open sales order/);

      const voids = await db.documentVoid.findMany({ where: { docId: order.id } });
      expect(voids).toHaveLength(1);
      expect(voids[0]).toMatchObject({ docType: "SALES_ORDER", docNumber: order.number, reason: "Buyer cancelled the PO", voidedById: staff.id });
      expect((voids[0]!.snapshot as { number: string }).number).toBe(order.number);
      const audit = await db.auditLog.findFirst({ where: { entityType: "SalesOrder", entityId: order.id, action: "void" } });
      expect(audit).toBeTruthy();

      // Now the quote can be voided, and that writes its own void record.
      await voidQuote(q.id, "Lost to competitor", costUser);
      const qv = await db.documentVoid.findFirst({ where: { docId: q.id } });
      expect(qv).toMatchObject({ docType: "QUOTE", docNumber: q.number, reason: "Lost to competitor" });
      await expect(voidQuote(q.id, "again", costUser)).rejects.toThrow(/already void/);
    });

    it("the quote view lists every SO made from it, voided ones included", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const first = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-A", deliveryAddress: null }, costUser);
      await voidSalesOrder(first.id, "Wrong buyer PO", staff);
      const second = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-B", deliveryAddress: null }, costUser);
      const view = (await getQuoteView(q.id, costUser))!;
      expect(view.salesOrders.map((s) => [s.number, s.status, s.buyerPoNo])).toEqual([
        [second.number, "OPEN", "PO-B"],
        [first.number, "VOID", "PO-A"],
      ]);
      expect(view.salesOrders[1]!.voidReason).toBe("Wrong buyer PO");
      expect(view.salesOrders[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("void needs a reason", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      await expect(voidQuote(q.id, "  ", costUser)).rejects.toThrow(/reason/);
    });
  });

  // -------------------------------------------------------------------------
  describe("permissions, print, email, no delete", () => {
    it("viewers can't create, edit, convert or void", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), staff);
      await expect(createQuote(quoteInput(customer.id, (await freshYear())), viewer)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updateQuote(q.id, quoteInput(customer.id, 2026), viewer)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, viewer)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(voidQuote(q.id, "nope", viewer)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(buildQuoteEmailDraft(q.id, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("print data has no costs, margins or withholding", async () => {
      const customer = await makeCustomer([], "GOVERNMENT");
      const supplier = await makeSupplier();
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), { withholdingCodes: ["GOODS_1", "GOV_PT_3"] }, supplier.id), costUser);
      const order = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-9", deliveryAddress: null }, costUser);
      for (const doc of [await getQuotePrint(q.id), await getSalesOrderPrint(order.id)]) {
        const keys = keysDeep(doc);
        for (const k of [...COST_KEYS, "withholding", "withholdingTotal", "netReceived"]) expect(keys.has(k), `${k} on print`).toBe(false);
        expect(JSON.stringify(doc)).not.toContain(supplier.name);
        expect(doc?.contractPrice).toBe("540000.00");
      }
    });

    it("email builds a draft only and logs email_draft", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), { contactId: customer.contacts[0]!.id }), staff);
      const draft = await buildQuoteEmailDraft(q.id, staff);
      expect(draft.to).toBe(customer.contacts[0]!.email);
      expect(draft.subject).toBe(`Quotation ${q.number}`);
      expect(draft.body).toContain(q.number);
      const log = await db.auditLog.findFirst({ where: { entityType: "Quote", entityId: q.id, action: "email_draft" } });
      expect(log).toBeTruthy();
    });

    it("hard deletes still throw on the new tables", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      await expect(db.quote.delete({ where: { id: q.id } })).rejects.toBeInstanceOf(HardDeleteError);
      await expect(db.quoteItem.deleteMany({ where: { quoteId: q.id } })).rejects.toBeInstanceOf(HardDeleteError);
      await expect(db.documentSeries.deleteMany({})).rejects.toBeInstanceOf(HardDeleteError);
      await expect(db.documentVoid.deleteMany({})).rejects.toBeInstanceOf(HardDeleteError);
      expect(await db.quote.findUnique({ where: { id: q.id } })).toBeTruthy();
    });
  });
});
