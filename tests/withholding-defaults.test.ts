import { describe, expect, it } from "vitest";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import {
  ATC_LABELS,
  WITHHOLDING_DEFAULT_ROWS,
  WITHHOLDING_HINT_NONE,
  WITHHOLDING_HINT_NOT_SET,
  WITHHOLDING_NOT_SET_NOTICE,
  customerWithholdingHint,
  defaultWithholdingFor,
  isWithholdingNone,
  isWithholdingNotSet,
  lineWithholdingFromPicks,
  needsWithholdingTypeWarning,
} from "@/lib/quotes/withholding-defaults";

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
  it("Goods 1% + GOV_PT 3% → goods 4%, services 3%", () => {
    const picks = [snap("GOODS_1"), snap("GOV_PT_3")];
    expect(lineWithholdingFromPicks(picks, "GOODS")).toMatchObject({
      rate: "0.0400",
      atc: null,
      code: null,
      label: null,
    });
    expect(lineWithholdingFromPicks(picks, "SERVICES")).toEqual({
      rate: "0.0300",
      atc: "WG010",
      code: "GOV_PT_3",
      label: WITHHOLDING_DEFAULT_ROWS.GOV_PT_3.label,
      lineKind: "GOV_PT",
    });
  });

  it("empty picks → zero", () => {
    expect(lineWithholdingFromPicks([], "GOODS")).toEqual(ZERO);
  });
});

describe("customerWithholdingHint", () => {
  it("not set / none / picked labels", () => {
    expect(customerWithholdingHint(null)).toBe(WITHHOLDING_HINT_NOT_SET);
    expect(customerWithholdingHint([])).toBe(WITHHOLDING_HINT_NONE);
    expect(customerWithholdingHint([snap("GOODS_1")])).toBe("Withholding: Goods 1% (WI158)");
    expect(customerWithholdingHint([snap("GOODS_1"), snap("GOV_PT_3")])).toBe(
      "Withholding: Goods 1% (WI158) + Government percentage tax 3% (code to confirm) (code to confirm)",
    );
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
  it("keeps TWA and gov labels in one map; gov marked UNVERIFIED + code to confirm", () => {
    expect(ATC_LABELS.WI158).toContain("goods");
    expect(ATC_LABELS.WI160).toContain("services");
    expect(ATC_LABELS.WG010).toMatch(/UNVERIFIED/);
    expect(ATC_LABELS.WG010).toMatch(/code to confirm/);
    expect(ATC_LABELS.WV050).toMatch(/UNVERIFIED/);
    expect(ATC_LABELS.WV050).toMatch(/code to confirm/);
  });
});
