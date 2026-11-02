import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Customer } from "@prisma/client";
import { CustomerForm } from "@/app/(app)/customers/CustomerForm";
import { WithholdingPickField } from "@/components/WithholdingPickField";
import { docTotals, type WithholdingSnapshot } from "@/lib/quotes/calc";
import {
  ATC_LABELS,
  GOV_PT_3_HINT,
  WITHHOLDING_PICK_FIELD_HINT,
  WITHHOLDING_DEFAULT_CATALOG,
  WITHHOLDING_DEFAULT_ROWS,
  WITHHOLDING_HINT_NONE,
  WITHHOLDING_HINT_NOT_SET,
  WITHHOLDING_NOT_SET_NOTICE,
  customerWithholdingHint,
  defaultWithholdingFor,
  defaultWithholdingPickFor,
  isWithholdingNone,
  isWithholdingNotSet,
  lineWithholdingChipsFromPicks,
  lineWithholdingFromPicks,
  lineWithholdingSnapshotFromPicks,
  needsWithholdingTypeWarning,
} from "@/lib/quotes/withholding-defaults";
import type { FormState } from "@/lib/validation/forms";

const ZERO = { rate: "0.0000", atc: null, code: null, label: null, lineKind: null };

function snap(code: keyof typeof WITHHOLDING_DEFAULT_ROWS): WithholdingSnapshot {
  const r = WITHHOLDING_DEFAULT_ROWS[code];
  return { code: r.code, label: r.label, lineKind: r.lineKind, rate: r.rate, atcCode: r.atcCode };
}

describe("defaultWithholdingFor (deprecated — type never chooses rates)", () => {
  it("always returns ZERO for GOVERNMENT / TWA / NONE / unknown", () => {
    for (const type of [
      "GOVERNMENT",
      "TOP_WITHHOLDING_AGENT",
      "NONE",
      undefined,
      null,
      "",
      "UNKNOWN",
      "twa",
    ]) {
      for (const kind of ["GOODS", "SERVICES", "GOV_VAT"] as const) {
        expect(defaultWithholdingFor(type, kind)).toEqual(ZERO);
      }
    }
    expect(needsWithholdingTypeWarning("GOVERNMENT")).toBe(false);
    expect(needsWithholdingTypeWarning(undefined)).toBe(false);
    expect(WITHHOLDING_NOT_SET_NOTICE).toMatch(/not set/i);
  });
});

describe("lineWithholdingFromPicks", () => {
  it("government goods 1% + percentage tax 3% → goods 4% with no ATC (never 4% WI640)", () => {
    const picks = [snap("GOV_GOODS_1"), snap("GOV_PT_3")];
    expect(lineWithholdingFromPicks(picks, "GOODS")).toEqual({
      rate: "0.0400",
      atc: null,
      code: null,
      label: null,
      lineKind: null,
    });
    expect(lineWithholdingFromPicks(picks, "SERVICES")).toEqual({
      rate: "0.0300",
      atc: "WB080",
      code: "GOV_PT_3",
      label: WITHHOLDING_DEFAULT_ROWS.GOV_PT_3.label,
      lineKind: "GOV_PT",
    });
  });

  it("government services 2% + percentage tax 3% → services 5% with no ATC", () => {
    const picks = [snap("GOV_SERVICES_2"), snap("GOV_PT_3")];
    expect(lineWithholdingFromPicks(picks, "SERVICES")).toEqual({
      rate: "0.0500",
      atc: null,
      code: null,
      label: null,
      lineKind: null,
    });
    expect(lineWithholdingFromPicks(picks, "GOODS")).toMatchObject({
      rate: "0.0300",
      atc: "WB080",
      code: "GOV_PT_3",
    });
  });

  it("empty picks → zero", () => {
    expect(lineWithholdingFromPicks([], "GOODS")).toEqual(ZERO);
  });
});

describe("lineWithholdingChipsFromPicks", () => {
  it("stacked goods line → one chip per code; each % matches its own ATC (never 4% WI640)", () => {
    const picks = [snap("GOV_GOODS_1"), snap("GOV_PT_3")];
    const goods = lineWithholdingChipsFromPicks(picks, "GOODS");
    expect(goods.map((c) => c.chipLabel)).toEqual(["WHT 1% WI640", "WHT 3% WB080"]);
    for (const c of goods) {
      const ownPct = (Number(c.rate) * 100).toFixed(2).replace(/\.?0+$/, "");
      expect(c.chipLabel).toBe(`WHT ${ownPct}% ${c.atc}`);
      expect(c.chipLabel).not.toMatch(/WHT 4%/);
    }
    // Combined money rate still 4%, but never paired with a single ATC.
    const money = lineWithholdingFromPicks(picks, "GOODS");
    expect(money.rate).toBe("0.0400");
    expect(money.atc).toBeNull();

    const services = lineWithholdingChipsFromPicks(picks, "SERVICES");
    expect(services.map((c) => c.chipLabel)).toEqual(["WHT 3% WB080"]);
  });

  it("stacked services line → WHT 2% WI157 + WHT 3% WB080", () => {
    const picks = [snap("GOV_SERVICES_2"), snap("GOV_PT_3")];
    const chips = lineWithholdingChipsFromPicks(picks, "SERVICES");
    expect(chips.map((c) => ({ code: c.code, chipLabel: c.chipLabel, rate: c.rate }))).toEqual([
      { code: "GOV_SERVICES_2", chipLabel: "WHT 2% WI157", rate: "0.0200" },
      { code: "GOV_PT_3", chipLabel: "WHT 3% WB080", rate: "0.0300" },
    ]);
  });
});

describe("Pass 3 Settings catalog", () => {
  it("lists six rates in order; VAT inactive by default; no Goods 4% / code to confirm", () => {
    expect(WITHHOLDING_DEFAULT_CATALOG.map((r) => r.code)).toEqual([
      "GOV_GOODS_1",
      "GOV_SERVICES_2",
      "GOV_PT_3",
      "GOODS_1",
      "SERVICES_2",
      "GOV_VAT_5",
    ]);
    expect(WITHHOLDING_DEFAULT_ROWS.GOV_GOODS_1.label).toBe("Government goods 1% (WI640)");
    expect(WITHHOLDING_DEFAULT_ROWS.GOV_SERVICES_2.label).toBe("Government services 2% (WI157)");
    expect(WITHHOLDING_DEFAULT_ROWS.GOV_PT_3.label).toBe("Government percentage tax 3% (WB080)");
    expect(WITHHOLDING_DEFAULT_ROWS.GOODS_1.label).toBe("Private top agent goods 1% (WI158)");
    expect(WITHHOLDING_DEFAULT_ROWS.SERVICES_2.label).toBe("Private top agent services 2% (WI160)");
    expect(WITHHOLDING_DEFAULT_ROWS.GOV_VAT_5.label).toBe("VAT withheld 5% (WV010/WV020)");
    expect(WITHHOLDING_DEFAULT_ROWS.GOV_VAT_5.active).toBe(false);
    for (const r of WITHHOLDING_DEFAULT_CATALOG) {
      expect(r.label).not.toMatch(/code to confirm/i);
      expect(r.label).not.toBe("Goods 4%");
      expect(r.code).not.toMatch(/^LINE_/);
    }
    expect(WITHHOLDING_DEFAULT_CATALOG.filter((r) => r.active).map((r) => r.code)).not.toContain("GOV_VAT_5");
    // WG010 is a legacy WB080 alias only — must never return to the Settings picker.
    expect(WITHHOLDING_DEFAULT_CATALOG.map((r) => r.code)).not.toContain("WG010");
    expect(WITHHOLDING_DEFAULT_CATALOG.map((r) => r.atcCode)).not.toContain("WG010");
    // WV050 is 12% non-resident VAT — not a Settings catalog / 5% VAT row.
    expect(WITHHOLDING_DEFAULT_CATALOG.map((r) => r.atcCode)).not.toContain("WV050");
  });
});

describe("customerWithholdingHint", () => {
  it("not set / none / picked labels", () => {
    expect(customerWithholdingHint(null)).toBe(WITHHOLDING_HINT_NOT_SET);
    expect(customerWithholdingHint([])).toBe(WITHHOLDING_HINT_NONE);
    expect(customerWithholdingHint([snap("GOODS_1")])).toBe(
      "Withholding: Private top agent goods 1% (WI158)",
    );
    expect(customerWithholdingHint([snap("GOV_GOODS_1"), snap("GOV_PT_3")])).toBe(
      "Withholding: Government goods 1% (WI640) + Government percentage tax 3% (WB080)",
    );
  });
});

const activeRates: WithholdingSnapshot[] = WITHHOLDING_DEFAULT_CATALOG.filter((r) => r.active && r.code !== "GOV_VAT_5").map(
  (r) => ({ code: r.code, label: r.label, lineKind: r.lineKind, rate: r.rate, atcCode: r.atcCode }),
);

function checkboxTag(html: string, code: string): string {
  const tag = html.match(new RegExp(`<input\\b(?=[^>]*\\bvalue="${code}")[^>]*>`));
  expect(tag, code).not.toBeNull();
  return tag![0];
}

function isChecked(tag: string): boolean {
  return /\bchecked\b/.test(tag);
}

const noopAction = async (): Promise<FormState> => ({ ok: true });

describe("defaultWithholdingPickFor (new customer only)", () => {
  it("government pre-ticks goods 1% and services 2%, never the 3%", () => {
    expect(defaultWithholdingPickFor("GOVERNMENT")).toEqual(["GOV_GOODS_1", "GOV_SERVICES_2"]);
    expect(defaultWithholdingPickFor("GOVERNMENT")).not.toContain("GOV_PT_3");
    expect(GOV_PT_3_HINT).toBe("Only if the agency says so; not usual on the 8% option");
    expect(WITHHOLDING_PICK_FIELD_HINT).toContain("for example Government goods 1% + Government services 2%");
    expect(WITHHOLDING_PICK_FIELD_HINT).not.toMatch(/3%/);
  });

  it("top withholding agent pre-ticks nothing; none is an explicit empty pick", () => {
    expect(defaultWithholdingPickFor("TOP_WITHHOLDING_AGENT")).toBeNull();
    expect(defaultWithholdingPickFor("")).toBeNull();
    expect(defaultWithholdingPickFor(null)).toBeNull();
    expect(defaultWithholdingPickFor(undefined)).toBeNull();
    expect(defaultWithholdingPickFor("mystery")).toBeNull();
    expect(defaultWithholdingPickFor("NONE")).toEqual([]);
  });

  it("quote lines and totals for a goods/services mix use centavo half-up and skip the 3%", () => {
    const codes = defaultWithholdingPickFor("GOVERNMENT");
    expect(codes).toEqual(["GOV_GOODS_1", "GOV_SERVICES_2"]);
    const picks = codes!.map((code) => snap(code as keyof typeof WITHHOLDING_DEFAULT_ROWS));
    const goods = lineWithholdingSnapshotFromPicks(picks, "GOODS");
    const services = lineWithholdingSnapshotFromPicks(picks, "SERVICES");
    expect(goods).toEqual({ withholdingRate: "0.0100", withholdingAtc: "WI640", withholdingOverride: false });
    expect(services).toEqual({ withholdingRate: "0.0200", withholdingAtc: "WI157", withholdingOverride: false });
    expect(lineWithholdingChipsFromPicks(picks, "GOODS").map((c) => c.chipLabel)).toEqual(["WHT 1% WI640"]);
    expect(lineWithholdingChipsFromPicks(picks, "SERVICES").map((c) => c.chipLabel)).toEqual(["WHT 2% WI157"]);

    // 100.50 × 1% = 1.005 → 1.01; 1.25 × 2% = 0.025 → 0.03. No WB080 row.
    const lines = [
      { kind: "GOODS" as const, qty: "1", unitPrice: "100.50", supplierUnitCost: "0", withholdingRate: goods.withholdingRate, withholdingAtc: goods.withholdingAtc },
      { kind: "SERVICES" as const, qty: "1", unitPrice: "1.25", supplierUnitCost: "0", withholdingRate: services.withholdingRate, withholdingAtc: services.withholdingAtc },
    ];
    const fromLines = docTotals(lines);
    const fromPicks = docTotals(lines, picks);
    expect(fromLines.withholdingTotal).toBe("1.04");
    expect(fromLines.netReceived).toBe("100.71");
    expect(fromLines.contractPrice).toBe("101.75");
    expect(fromLines.withholding.map((w) => w.atcCode)).toEqual(["WI640", "WI157"]);
    expect(fromLines.withholding.map((w) => w.amount)).toEqual(["1.01", "0.03"]);
    expect(fromPicks.withholdingTotal).toBe("1.04");
    expect(fromPicks.withholding.map((w) => w.code)).toEqual(["GOV_GOODS_1", "GOV_SERVICES_2"]);
    expect(JSON.stringify(fromPicks)).not.toContain("GOV_PT_3");
    expect(JSON.stringify(fromPicks)).not.toContain("WB080");
  });
});

describe("government withholding checkboxes", () => {
  it("new-customer default ticks 1% and 2% and leaves 3% unticked with its hint", () => {
    const html = renderToStaticMarkup(
      createElement(WithholdingPickField, {
        rates: activeRates,
        value: defaultWithholdingPickFor("GOVERNMENT"),
        onChange: () => {},
      }),
    );
    expect(isChecked(checkboxTag(html, "GOV_GOODS_1"))).toBe(true);
    expect(isChecked(checkboxTag(html, "GOV_SERVICES_2"))).toBe(true);
    expect(isChecked(checkboxTag(html, "GOV_PT_3"))).toBe(false);
    expect(html).toContain(GOV_PT_3_HINT);
    expect(html).toContain("for example Government goods 1% + Government services 2%");
    expect(html).not.toContain("Government percentage tax 3%).");
    expect(html).toContain("Government goods 1% (WI640)");
    expect(html).toContain("Government services 2% (WI157)");
    const labelAt = html.indexOf('class="wh-pick-row"');
    const inputAt = html.indexOf("<input", labelAt);
    const textAt = html.indexOf("Government goods 1%");
    expect(labelAt).toBeGreaterThan(-1);
    expect(inputAt).toBeGreaterThan(labelAt);
    expect(inputAt).toBeLessThan(textAt);
  });

  it("top withholding agent and none pre-tick nothing", () => {
    const twa = renderToStaticMarkup(
      createElement(WithholdingPickField, {
        rates: activeRates,
        value: defaultWithholdingPickFor("TOP_WITHHOLDING_AGENT"),
        onChange: () => {},
      }),
    );
    expect(isChecked(checkboxTag(twa, "GOV_GOODS_1"))).toBe(false);
    expect(isChecked(checkboxTag(twa, "GOV_SERVICES_2"))).toBe(false);
    expect(isChecked(checkboxTag(twa, "GOV_PT_3"))).toBe(false);
    expect(twa).toContain(GOV_PT_3_HINT);

    const none = defaultWithholdingPickFor("NONE");
    expect(none).toEqual([]);
  });

  it("an existing government customer keeps the saved pick (3% only), not the new default", () => {
    const customer = {
      name: "Sample Agency",
      tin: null,
      withholdingType: "GOVERNMENT",
      defaultWithholding: ["GOV_PT_3"],
      defaultTerms: null,
      notes: null,
    } as Customer;
    const html = renderToStaticMarkup(
      createElement(CustomerForm, {
        customer,
        terms: ["Net 30"],
        rates: activeRates,
        action: noopAction,
        canEdit: true,
        canEditWithholding: true,
      }),
    );
    expect(isChecked(checkboxTag(html, "GOV_PT_3"))).toBe(true);
    expect(isChecked(checkboxTag(html, "GOV_GOODS_1"))).toBe(false);
    expect(isChecked(checkboxTag(html, "GOV_SERVICES_2"))).toBe(false);
    expect(html).toContain(GOV_PT_3_HINT);
    expect(html).toContain("Yes, Government office");
  });
});

describe("isWithholdingNotSet / isWithholdingNone", () => {
  it("null/undefined = not set; [] = none; codes = neither", () => {
    expect(isWithholdingNotSet(null)).toBe(true);
    expect(isWithholdingNotSet(undefined)).toBe(true);
    expect(isWithholdingNotSet([])).toBe(false);
    expect(isWithholdingNotSet(["GOODS_1"])).toBe(false);

    expect(isWithholdingNone([])).toBe(true);
    expect(isWithholdingNone(null)).toBe(false);
    expect(isWithholdingNone(undefined)).toBe(false);
    expect(isWithholdingNone(["GOODS_1"])).toBe(false);
  });
});

describe("ATC_LABELS config map", () => {
  it("Confirmed ATC codes from 2307; no code-to-confirm wording", () => {
    expect(ATC_LABELS.WI640).toContain("government goods");
    expect(ATC_LABELS.WI157).toContain("government services");
    expect(ATC_LABELS.WB080).toContain("percentage tax");
    expect(ATC_LABELS.WI158).toContain("goods");
    expect(ATC_LABELS.WI160).toContain("services");
    expect(ATC_LABELS["WV010/WV020"]).toContain("VAT");
    for (const v of Object.values(ATC_LABELS)) {
      expect(v).not.toMatch(/code to confirm/i);
    }
  });
});
