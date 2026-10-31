// Quotes and sales orders against a real MySQL 8 database (TEST_DATABASE_URL).
// Run: TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/hacien_test npm test

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
import { DocRuleError, ymd } from "@/lib/documents/common";
import { addDays } from "@/lib/format";
import { LEGACY_WITHHOLDING_REAPPLY_REQUIRED } from "@/lib/quotes/legacy-withholding";
import {
  buildQuoteEmailDraft,
  convertQuoteToSalesOrder,
  createQuote,
  markQuoteSent,
  refreshQuoteCompanyDetails,
  updateQuote,
  voidQuote,
  type DocActor,
} from "@/lib/services/quotes";
import { updateSalesOrder, voidSalesOrder } from "@/lib/services/sales-orders";
import { listWithholdingRates, saveWithholdingRates, snapshotList } from "@/lib/services/withholding";
import { getQuotePrint, getQuoteView, getSalesOrderPrint, getSalesOrderView, listQuotesView } from "@/lib/quotes/views";
import { saveSettings } from "@/lib/settings";
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
    it("Government customer with nothing picked (null) → 0 WH; pick stays not set", async () => {
      const customer = await makeCustomer(null, "GOVERNMENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      expect(q.withholdingTotal.toFixed(2)).toBe("0.00");
      expect(q.withholdingPick).toBeNull();
      for (const i of q.items) {
        expect(Number(i.withholdingRate).toFixed(4)).toBe("0.0000");
      }
    });

    it("customer saved Government goods 1% + GOV_PT 3% → goods 4% (null ATC), services 3%; mixed quote WH = 21400", async () => {
      const customer = await makeCustomer(["GOV_GOODS_1", "GOV_PT_3"], "GOVERNMENT");
      const supplier = await makeSupplier();
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), {}, supplier.id), costUser);
      expect(q.contractPrice.toFixed(2)).toBe("540000.00");
      const goods = q.items.find((i) => i.kind === "GOODS")!;
      const services = q.items.find((i) => i.kind === "SERVICES")!;
      expect(Number(goods.withholdingRate).toFixed(4)).toBe("0.0400");
      expect(Number(services.withholdingRate).toFixed(4)).toBe("0.0300");
      // Stacked goods: money is 4% with no single ATC (never persist "4% WI640").
      expect(goods.withholdingAtc).toBeNull();
      expect(services.withholdingAtc).toBe("WB080");
      // 520000×0.04 + 20000×0.03 = 20800 + 600
      expect(q.withholdingTotal.toFixed(2)).toBe("21400.00");
      expect(q.netReceived.toFixed(2)).toBe("518600.00");
      expect(Array.isArray(q.withholdingPick) ? q.withholdingPick : null).toEqual(["GOV_GOODS_1", "GOV_PT_3"]);
    });

    it("customer saved Government services 2% + GOV_PT 3% → services 5% (null ATC)", async () => {
      const customer = await makeCustomer(["GOV_SERVICES_2", "GOV_PT_3"], "GOVERNMENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const services = q.items.find((i) => i.kind === "SERVICES")!;
      const goods = q.items.find((i) => i.kind === "GOODS")!;
      expect(Number(services.withholdingRate).toFixed(4)).toBe("0.0500");
      expect(Number(goods.withholdingRate).toFixed(4)).toBe("0.0300");
      // Stacked services: money is 5% with no single ATC (never persist "5% WI157").
      expect(services.withholdingAtc).toBeNull();
      expect(goods.withholdingAtc).toBe("WB080");
      // 520000×0.03 + 20000×0.05 = 15600 + 1000
      expect(q.withholdingTotal.toFixed(2)).toBe("16600.00");
    });

    it("VAT withheld 5% is inactive by default in Settings catalog", async () => {
      const vat = await db.withholdingRate.findUnique({ where: { code: "GOV_VAT_5" } });
      expect(vat).not.toBeNull();
      expect(vat!.active).toBe(false);
      expect(vat!.label).toBe("VAT withheld 5% (WV010/WV020)");
      expect(vat!.atcCode).toBe("WV010/WV020");
    });

    it("changing pick on one quote does not change customer saved pick or other quotes", async () => {
      const customer = await makeCustomer(["GOODS_1"], "TOP_WITHHOLDING_AGENT");
      const year = await freshYear();
      const a = await createQuote(quoteInput(customer.id, year), costUser);
      const b = await createQuote(quoteInput(customer.id, year), costUser);
      expect(Number(a.items.find((i) => i.kind === "GOODS")!.withholdingRate).toFixed(4)).toBe("0.0100");
      expect(Number(b.items.find((i) => i.kind === "GOODS")!.withholdingRate).toFixed(4)).toBe("0.0100");

      const input = quoteInput(customer.id, year, {
        withholdingCodes: ["GOODS_1", "GOV_PT_3"],
        reapplyWithholding: true,
        items: a.items
          .filter((i) => !i.removedAt)
          .sort((x, y) => x.sortOrder - y.sortOrder)
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
      const updated = await updateQuote(a.id, { ...input, date: a.date }, costUser);
      expect(Number(updated.items.find((i) => i.kind === "GOODS")!.withholdingRate).toFixed(4)).toBe("0.0400");
      expect(updated.withholdingTotal.toFixed(2)).toBe("21400.00");

      const cust = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(cust.defaultWithholding).toEqual(["GOODS_1"]);

      const b2 = await db.quote.findUniqueOrThrow({ where: { id: b.id }, include: { items: { where: { removedAt: null } } } });
      expect(Number(b2.items.find((i) => i.kind === "GOODS")!.withholdingRate).toFixed(4)).toBe("0.0100");
      expect(Number(b2.withholdingTotal).toFixed(2)).toBe(Number(b.withholdingTotal).toFixed(2));
      expect(b2.withholdingPick).toEqual(["GOODS_1"]);
    });

    it("changing customer pick does not change existing quotes/SOs (snapshot)", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, costUser);
      const beforeQ = {
        pick: q.withholdingPick,
        total: Number(q.withholdingTotal).toFixed(2),
        rates: q.items.map((i) => ({ kind: i.kind, rate: Number(i.withholdingRate).toFixed(4) })),
      };
      const beforeSo = {
        total: Number(so.withholdingTotal).toFixed(2),
        rates: so.items.map((i) => ({ kind: i.kind, rate: Number(i.withholdingRate).toFixed(4) })),
      };

      await db.customer.update({
        where: { id: customer.id },
        data: { defaultWithholding: ["GOV_PT_3"] },
      });

      const q2 = await db.quote.findUniqueOrThrow({ where: { id: q.id }, include: { items: { where: { removedAt: null } } } });
      const so2 = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: { where: { removedAt: null } } } });
      expect(q2.withholdingPick).toEqual(beforeQ.pick);
      expect(Number(q2.withholdingTotal).toFixed(2)).toBe(beforeQ.total);
      expect(q2.items.map((i) => ({ kind: i.kind, rate: Number(i.withholdingRate).toFixed(4) }))).toEqual(beforeQ.rates);
      expect(Number(so2.withholdingTotal).toFixed(2)).toBe(beforeSo.total);
      expect(so2.items.map((i) => ({ kind: i.kind, rate: Number(i.withholdingRate).toFixed(4) }))).toEqual(beforeSo.rates);
    });

    it("line WH% drives totals; mixed Goods 1% + Services 2%", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const created = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      expect(created.withholdingTotal.toFixed(2)).toBe("5600.00"); // 5200 + 400
    });

    it("manual line override drives totals and survives re-apply", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const created = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const input = quoteInput(customer.id, 2026, {
        items: [
          {
            id: created.items.find((i) => i.kind === "GOODS")!.id,
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
            id: created.items.find((i) => i.kind === "SERVICES")!.id,
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
      // 520000×1.5% + 20000×2% = 7800 + 400
      expect(updated.withholdingTotal.toFixed(2)).toBe("8200.00");
      const goods = updated.items.find((i) => i.kind === "GOODS")!;
      expect(Number(goods.withholdingRate).toFixed(4)).toBe("0.0150");
      expect(goods.withholdingOverride).toBe(true);

      await db.customer.update({ where: { id: customer.id }, data: { defaultWithholding: ["GOV_PT_3"] } });
      const reapplied = await updateQuote(
        created.id,
        {
          ...input,
          date: created.date,
          withholdingCodes: ["GOV_PT_3"],
          reapplyWithholding: true,
          items: updated.items
            .filter((i) => !i.removedAt)
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
              withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
              withholdingAtc: i.withholdingAtc,
              withholdingOverride: i.withholdingOverride,
            })),
        },
        costUser,
      );
      const goodsAfter = reapplied.items.find((i) => i.kind === "GOODS")!;
      const servicesAfter = reapplied.items.find((i) => i.kind === "SERVICES")!;
      expect(Number(goodsAfter.withholdingRate).toFixed(4)).toBe("0.0150");
      expect(goodsAfter.withholdingOverride).toBe(true);
      expect(Number(servicesAfter.withholdingRate).toFixed(4)).toBe("0.0300");
      expect(servicesAfter.withholdingAtc).toBe("WB080");
      // 520000×1.5% + 20000×3% = 7800 + 600
      expect(reapplied.withholdingTotal.toFixed(2)).toBe("8400.00");
    });

    it("a later customer pick change does not alter existing lines, prints or EWT document snapshot", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const beforeLines = q.items.map((i) => ({
        id: i.id,
        rate: Number(i.withholdingRate).toFixed(4),
        atc: i.withholdingAtc,
      }));
      const beforeDoc = snapshotList(q.withholding);

      await db.customer.update({ where: { id: customer.id }, data: { defaultWithholding: ["GOV_PT_3"] } });

      const view = await getQuoteView(q.id, costUser);
      expect(view?.withholding).toEqual(beforeDoc);
      expect(view?.totals.withholdingTotal).toBe(Number(q.withholdingTotal).toFixed(2));
      expect(
        view?.items.map((i) => ({ id: i.id, rate: i.withholdingRate, atc: i.withholdingAtc })),
      ).toEqual(beforeLines.map((l) => ({ id: l.id, rate: l.rate, atc: l.atc })));

      const print = await getQuotePrint(q.id);
      expect(print?.contractPrice).toBe("540000.00");
      // Print still has no withholding breakdown keys.
      expect(JSON.stringify(print)).not.toMatch(/withholdingTotal|WI158|WB080/);

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

    it("Re-apply customer's withholding refreshes non-override lines from the customer pick", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      await db.customer.update({ where: { id: customer.id }, data: { defaultWithholding: ["GOV_PT_3"] } });
      const input = quoteInput(customer.id, 2026, {
        withholdingCodes: ["GOV_PT_3"],
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
      expect(Array.isArray(reapplied.withholdingPick) ? reapplied.withholdingPick : null).toEqual(["GOV_PT_3"]);
      // 520000×3% + 20000×3% = 15600 + 600
      expect(reapplied.withholdingTotal.toFixed(2)).toBe("16200.00");
      for (const i of reapplied.items.filter((x) => !x.removedAt)) {
        expect(Number(i.withholdingRate).toFixed(4)).toBe("0.0300");
        expect(i.withholdingAtc).toBe("WB080");
        expect(i.withholdingOverride).toBe(false);
      }
    });

    it("legacy NULL line rates do not change stored totals on view", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      // Simulate pre-migration rows: clear line rates, keep stored money.
      await db.quoteItem.updateMany({ where: { quoteId: q.id }, data: { withholdingRate: null, withholdingAtc: null, withholdingOverride: false } });
      const view = await getQuoteView(q.id, costUser);
      expect(view?.totals.withholdingTotal).toBe(Number(q.withholdingTotal).toFixed(2));
      expect(view?.totals.contractPrice).toBe(Number(q.contractPrice).toFixed(2));
      expect(view?.totals.netReceived).toBe(Number(q.netReceived).toFixed(2));
      expect(view?.items.every((i) => i.withholdingRate == null)).toBe(true);
    });

    it("legacy NULL line rates on a draft quote keep WH amount unchanged on save", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const storedWh = Number(q.withholdingTotal).toFixed(2);
      expect(storedWh).not.toBe("0.00");
      await db.quoteItem.updateMany({ where: { quoteId: q.id }, data: { withholdingRate: null, withholdingAtc: null, withholdingOverride: false } });

      const input = quoteInput(customer.id, 2026, {
        items: q.items
          .filter((i) => !i.removedAt)
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
            withholdingRate: null,
            withholdingAtc: null,
            withholdingOverride: false,
          })),
      });
      const saved = await updateQuote(q.id, { ...input, date: q.date }, costUser);
      expect(saved.withholdingTotal.toFixed(2)).toBe(storedWh);
      expect(Number(saved.netReceived).toFixed(2)).toBe(Number(q.netReceived).toFixed(2));
      // Save guard backfills rates from the doc JSON so a later save stays correct.
      for (const i of saved.items.filter((x) => !x.removedAt)) {
        expect(i.withholdingRate).not.toBeNull();
      }
    });

    it("explicit 0% on every line clears WH to ₱0 on save", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      expect(Number(q.withholdingTotal)).not.toBe(0);

      const input = quoteInput(customer.id, 2026, {
        items: q.items
          .filter((i) => !i.removedAt)
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
            withholdingRate: "0.0000",
            withholdingAtc: null,
            withholdingOverride: true,
          })),
      });
      const saved = await updateQuote(q.id, { ...input, date: q.date }, costUser);
      expect(saved.withholdingTotal.toFixed(2)).toBe("0.00");
      expect(Number(saved.netReceived).toFixed(2)).toBe(Number(saved.contractPrice).toFixed(2));
      for (const i of saved.items.filter((x) => !x.removedAt)) {
        expect(Number(i.withholdingRate).toFixed(4)).toBe("0.0000");
      }
    });

    it("Re-apply customer's withholding to none ([]) saves ₱0 WH", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      expect(Number(q.withholdingTotal)).not.toBe(0);

      await db.customer.update({ where: { id: customer.id }, data: { defaultWithholding: [] } });
      const input = quoteInput(customer.id, 2026, {
        withholdingCodes: [],
        withholdingExplicitNone: true,
        reapplyWithholding: true,
        items: q.items
          .filter((i) => !i.removedAt)
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
      const saved = await updateQuote(q.id, { ...input, date: q.date }, costUser);
      expect(saved.withholdingTotal.toFixed(2)).toBe("0.00");
      expect(snapshotList(saved.withholding)).toEqual([]);
      expect(saved.withholdingPick).toEqual([]);
      for (const i of saved.items.filter((x) => !x.removedAt)) {
        expect(Number(i.withholdingRate).toFixed(4)).toBe("0.0000");
        expect(i.withholdingOverride).toBe(false);
      }
    });

    it("legacy NULL lines with empty doc JSON fail closed and ask to re-apply", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      expect(Number(q.withholdingTotal)).not.toBe(0);

      await db.quoteItem.updateMany({
        where: { quoteId: q.id },
        data: { withholdingRate: null, withholdingAtc: null, withholdingOverride: false },
      });
      await db.quote.update({ where: { id: q.id }, data: { withholding: [] } });

      const input = quoteInput(customer.id, 2026, {
        items: q.items
          .filter((i) => !i.removedAt)
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
            withholdingRate: null,
            withholdingAtc: null,
            withholdingOverride: false,
          })),
      });
      await expect(updateQuote(q.id, { ...input, date: q.date }, costUser)).rejects.toMatchObject({
        name: "DocRuleError",
        message: LEGACY_WITHHOLDING_REAPPLY_REQUIRED,
      });
      const unchanged = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
      expect(Number(unchanged.withholdingTotal).toFixed(2)).toBe(Number(q.withholdingTotal).toFixed(2));
    });

    it("legacy NULL line rates on an open SO keep WH amount unchanged on save", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, costUser);
      const storedWh = Number(so.withholdingTotal).toFixed(2);
      expect(storedWh).not.toBe("0.00");
      await db.salesOrderItem.updateMany({
        where: { salesOrderId: so.id },
        data: { withholdingRate: null, withholdingAtc: null, withholdingOverride: false },
      });

      const items = so.items
        .filter((i) => !i.removedAt)
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
          withholdingRate: null as string | null,
          withholdingAtc: null as string | null,
          withholdingOverride: false,
        }));
      const saved = await updateSalesOrder(
        so.id,
        {
          contactId: so.contactId,
          buyerPoNo: so.buyerPoNo,
          buyerPoDate: so.buyerPoDate ?? undefined,
          deliveryAddress: so.deliveryAddress,
          terms: so.terms,
          notes: so.notes,
          items,
        },
        costUser,
      );
      expect(saved.withholdingTotal.toFixed(2)).toBe(storedWh);
      expect(Number(saved.netReceived).toFixed(2)).toBe(Number(so.netReceived).toFixed(2));
      for (const i of saved.items.filter((x) => !x.removedAt)) {
        expect(i.withholdingRate).not.toBeNull();
      }
    });

    it("an issued (Won) document is not recalculated when lines or the customer change", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, costUser);
      expect(Number(so.withholdingTotal).toFixed(2)).toBe(Number(q.withholdingTotal).toFixed(2));

      const won = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
      expect(won.status).toBe("WON");
      const storedTotal = Number(won.withholdingTotal).toFixed(2);

      await db.customer.update({ where: { id: customer.id }, data: { defaultWithholding: [] } });
      await db.quoteItem.updateMany({
        where: { quoteId: q.id },
        data: { withholdingRate: "0.0500", withholdingAtc: "WV050", unitPrice: 1 },
      });

      const view = await getQuoteView(q.id, costUser);
      expect(view?.totals.withholdingTotal).toBe(storedTotal);
      expect(view?.status).toBe("WON");
      await expect(updateQuote(q.id, quoteInput(customer.id, 2026), costUser)).rejects.toBeInstanceOf(DocRuleError);
    });

    it("a Settings rate change doesn't alter an existing quote's snapshotted line rates", async () => {
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
      const year = await freshYear();
      const q = await createQuote(
        quoteInput(customer.id, year, {
          items: [
            {
              id: null,
              description: "Laptop i5",
              kind: "GOODS",
              qty: "10",
              unit: "pc",
              supplierId: null,
              supplierUnitCost: "45000",
              unitPrice: "52000",
              withholdingRate: "0.0100",
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
              supplierUnitCost: "5000",
              unitPrice: "20000",
              withholdingRate: "0.0000",
              withholdingAtc: null,
              withholdingOverride: false,
            },
          ],
        }),
        costUser,
      );
      expect(q.withholdingTotal.toFixed(2)).toBe("5200.00");

      await save((await rowsNow()).map((r) => (r.code === code ? { ...r, ratePct: "5" } : r)));
      expect(Number((await db.withholdingRate.findUnique({ where: { code } }))?.rate)).toBe(0.05);

      const view = await getQuoteView(q.id, costUser);
      expect(view?.withholding.map((w) => w.rate)).toEqual(["0.0100"]);
      expect(view?.totals.withholdingTotal).toBe("5200.00");
      const input = quoteInput(customer.id, 2026, {
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
            withholdingRate: i.withholdingRate != null ? Number(i.withholdingRate).toFixed(4) : null,
            withholdingAtc: i.withholdingAtc,
            withholdingOverride: i.withholdingOverride,
          })),
      });
      const edited = await updateQuote(q.id, { ...input, date: q.date }, costUser);
      expect(edited.withholdingTotal.toFixed(2)).toBe("5200.00");

      await save((await rowsNow()).map((r) => (r.code === code ? { ...r, active: false } : r)));
    });
  });

  // -------------------------------------------------------------------------
  describe("cost hiding", () => {
    it("quote and SO payloads for a non-cost user contain no cost or margin fields", async () => {
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const supplier = await makeSupplier();
      const q = await createQuote(quoteInput(customer.id, (await freshYear()), {}, supplier.id), costUser);
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
      // TWA: 1% goods + 2% services = 5,600; net margin 540,000 − 5,600 − 455,000
      expect(full?.totals.netMargin).toBe("85000.00");
      expect(full?.items[0]?.supplierName).toBe(supplier.name);
      expect((await listQuotesView({ q: customer.name }, costUser))[0]?.netMarginPct).toBe("15.74");
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
      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
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

    it("customer notes print; internal notes never appear on quote/SO print models", async () => {
      const customer = await makeCustomer();
      const year = await freshYear();
      const q = await createQuote(
        quoteInput(customer.id, year, {
          notes: "CUSTOMER_NOTE_PRINT_ME",
          internalNotes: "INTERNAL_SECRET_NEVER_PRINT",
          subject: "Subject line prints",
          buyerPoNo: "RFQ-PHASE1-1",
        }),
        costUser,
      );
      const view = await getQuoteView(q.id, costUser);
      expect(view?.notes).toBe("CUSTOMER_NOTE_PRINT_ME");
      expect(view?.internalNotes).toBe("INTERNAL_SECRET_NEVER_PRINT");
      expect(view?.subject).toBe("Subject line prints");
      expect(view?.buyerPoNo).toBe("RFQ-PHASE1-1");

      const print = await getQuotePrint(q.id);
      expect(print?.notes).toBe("CUSTOMER_NOTE_PRINT_ME");
      expect(print?.subject).toBe("Subject line prints");
      expect(print?.buyerPoNo).toBe("RFQ-PHASE1-1");
      const blob = JSON.stringify(print);
      expect(blob).not.toContain("INTERNAL_SECRET_NEVER_PRINT");
      expect(blob).not.toContain("internalNotes");

      const order = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddress: null }, costUser);
      const soPrint = await getSalesOrderPrint(order.id);
      // SO keeps customer notes from the quote; still no internal notes key.
      expect(soPrint?.notes).toBe("CUSTOMER_NOTE_PRINT_ME");
      expect(JSON.stringify(soPrint)).not.toContain("INTERNAL_SECRET_NEVER_PRINT");
      expect(JSON.stringify(soPrint)).not.toContain("internalNotes");
    });

    it("valid until defaults from Settings when omitted on create", async () => {
      const { settings } = await getSettingsSnapshot();
      const customer = await makeCustomer();
      const year = await freshYear();
      const q = await createQuote(quoteInput(customer.id, year, { validUntil: undefined }), costUser);
      const expected = addDays(q.date, settings.quotes.defaultValidityDays);
      expect(ymd(q.validUntil)).toBe(ymd(expected));
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

    it("Use latest company details refreshes draft quotes and rejects sent ones", async () => {
      const customer = await makeCustomer();
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const pinned = q.settingsVersionId;
      const snap = await getSettingsSnapshot();
      // Save a new company settings version so "latest" differs from the quote pin.
      const saved = await saveSettings({
        key: "company",
        value: {
          ...snap.settings.company,
          tradeName: `Refresh Sample ${tag()}`,
          email: "refresh-sample@example.com",
        },
        userId: costUser.id,
        baseVersionId: snap.versionId,
      });
      expect(saved.ok && saved.changed).toBe(true);
      if (!saved.ok || !saved.changed) return;

      const refreshed = await refreshQuoteCompanyDetails(q.id, costUser);
      expect(refreshed.settingsVersionId).toBe(saved.version.id);
      expect(refreshed.settingsVersionId).not.toBe(pinned);
      const audit = await db.auditLog.findFirst({
        where: { entityType: "Quote", entityId: q.id, action: "update" },
        orderBy: { at: "desc" },
      });
      expect(audit?.before).toMatchObject({ settingsVersionId: pinned });
      expect(audit?.after).toMatchObject({ settingsVersionId: saved.version.id });

      await markQuoteSent(q.id, costUser);
      await expect(refreshQuoteCompanyDetails(q.id, costUser)).rejects.toBeInstanceOf(DocRuleError);
      await expect(refreshQuoteCompanyDetails(q.id, costUser)).rejects.toThrow(/draft \(unsent\)/i);
      expect((await db.quote.findUnique({ where: { id: q.id } }))?.settingsVersionId).toBe(saved.version.id);
    });
  });

  describe("line withholding backfill migration", () => {
    const sql = readFileSync(resolve(__dirname, "../../prisma/migrations/20261031140000_line_withholding_backfill/migration.sql"), "utf8");

    function statements(block: string): string[] {
      return block
        .split(";")
        .map((s) =>
          s
            .split("\n")
            .filter((l) => !l.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter(Boolean);
    }

    const backfill = statements(sql.slice(sql.indexOf("-- BEGIN line withholding backfill"), sql.indexOf("-- END line withholding backfill")));
    const commented = sql.match(/\/\*([\s\S]*?)\*\//)?.[1] ?? "";
    const rollback = statements(
      commented.slice(commented.indexOf("-- BEGIN rollback line withholding backfill"), commented.indexOf("-- END rollback line withholding backfill")),
    );

    it("backfill and rollback round-trip restore then clear rates from the doc JSON", async () => {
      expect(backfill.length).toBeGreaterThanOrEqual(2);
      expect(rollback.length).toBeGreaterThanOrEqual(2);

      const customer = await makeCustomer(["GOODS_1", "SERVICES_2"], "TOP_WITHHOLDING_AGENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, costUser);

      await db.quoteItem.updateMany({ where: { quoteId: q.id }, data: { withholdingRate: null, withholdingAtc: null, withholdingOverride: false } });
      await db.salesOrderItem.updateMany({
        where: { salesOrderId: so.id },
        data: { withholdingRate: null, withholdingAtc: null, withholdingOverride: false },
      });

      for (const stmt of backfill) await db.$executeRawUnsafe(stmt);

      const qItems = await db.quoteItem.findMany({ where: { quoteId: q.id, removedAt: null } });
      const soItems = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null } });
      expect(qItems.every((i) => i.withholdingRate != null)).toBe(true);
      expect(soItems.every((i) => i.withholdingRate != null)).toBe(true);
      expect(Number(qItems.find((i) => i.kind === "GOODS")!.withholdingRate).toFixed(4)).toBe("0.0100");
      expect(Number(qItems.find((i) => i.kind === "SERVICES")!.withholdingRate).toFixed(4)).toBe("0.0200");
      expect(Number(soItems.find((i) => i.kind === "GOODS")!.withholdingRate).toFixed(4)).toBe("0.0100");

      for (const stmt of rollback) await db.$executeRawUnsafe(stmt);

      const qAfter = await db.quoteItem.findMany({ where: { quoteId: q.id, removedAt: null } });
      const soAfter = await db.salesOrderItem.findMany({ where: { salesOrderId: so.id, removedAt: null } });
      expect(qAfter.every((i) => i.withholdingRate == null && i.withholdingAtc == null)).toBe(true);
      expect(soAfter.every((i) => i.withholdingRate == null && i.withholdingAtc == null)).toBe(true);

      // Re-run backfill restores again (idempotent for null rows).
      for (const stmt of backfill) await db.$executeRawUnsafe(stmt);
      expect((await db.quoteItem.findMany({ where: { quoteId: q.id, removedAt: null } })).every((i) => i.withholdingRate != null)).toBe(true);
    });

    it("Pass 2 with both GOV_PT and GOV_VAT in the JSON picks GOV_PT (documented priority)", async () => {
      const customer = await makeCustomer(["GOV_PT_3"], "GOVERNMENT");
      const q = await createQuote(quoteInput(customer.id, (await freshYear())), costUser);
      expect(Number(q.withholdingTotal)).not.toBe(0);

      // Both gov kinds in one snapshot (ambiguous under the old IN (...) join).
      await db.quote.update({
        where: { id: q.id },
        data: {
          withholding: [
            {
              code: "GOV_VAT_5",
              label: "Government VAT 5%",
              lineKind: "GOV_VAT",
              rate: "0.0500",
              atcCode: "WV050",
            },
            {
              code: "GOV_PT_3",
              label: "Government percentage tax 3%",
              lineKind: "GOV_PT",
              rate: "0.0300",
              atcCode: "WG010",
            },
          ],
        },
      });
      await db.quoteItem.updateMany({
        where: { quoteId: q.id },
        data: { withholdingRate: null, withholdingAtc: null, withholdingOverride: false },
      });

      for (const stmt of backfill) await db.$executeRawUnsafe(stmt);

      const items = await db.quoteItem.findMany({ where: { quoteId: q.id, removedAt: null } });
      expect(items.length).toBeGreaterThan(0);
      for (const i of items) {
        expect(Number(i.withholdingRate).toFixed(4)).toBe("0.0300");
        expect(i.withholdingAtc).toBe("WG010");
      }
    });
  });
});
