import { describe, expect, it } from "vitest";
import {
  ATC_LABELS,
  MISSING_WITHHOLDING_TYPE_WARNING,
  OVERRIDE_NOTE,
  allowGovVatOption,
  defaultWithholdingFor,
  documentWithholdingFromCustomer,
  lineDiffersFromUsual,
  lineWithholdingSnapshot,
  needsWithholdingTypeWarning,
} from "@/lib/quotes/withholding-defaults";
import { BUSINESS_IS_VAT_REGISTERED } from "@/lib/tax/constants";

describe("defaultWithholdingFor (customer type × line kind)", () => {
  it("TWA goods → 1% WI158", () => {
    expect(defaultWithholdingFor("TOP_WITHHOLDING_AGENT", "GOODS")).toEqual({
      rate: "0.0100",
      atc: "WI158",
      code: "GOODS_1",
      label: "Goods 1%",
      lineKind: "GOODS",
    });
  });

  it("TWA services → 2% WI160", () => {
    expect(defaultWithholdingFor("TOP_WITHHOLDING_AGENT", "SERVICES")).toEqual({
      rate: "0.0200",
      atc: "WI160",
      code: "SERVICES_2",
      label: "Services 2%",
      lineKind: "SERVICES",
    });
  });

  it("Gov goods → existing gov PT 3%", () => {
    expect(defaultWithholdingFor("GOVERNMENT", "GOODS")).toEqual({
      rate: "0.0300",
      atc: "WG010",
      code: "GOV_PT_3",
      label: "Government percentage tax 3%",
      lineKind: "GOV_PT",
    });
  });

  it("Gov services → existing gov PT 3%", () => {
    expect(defaultWithholdingFor("GOVERNMENT", "SERVICES")).toEqual({
      rate: "0.0300",
      atc: "WG010",
      code: "GOV_PT_3",
      label: "Government percentage tax 3%",
      lineKind: "GOV_PT",
    });
  });

  it("Gov VAT → existing gov VAT 5%", () => {
    expect(defaultWithholdingFor("GOVERNMENT", "GOV_VAT")).toEqual({
      rate: "0.0500",
      atc: "WV050",
      code: "GOV_VAT_5",
      label: "Government VAT 5%",
      lineKind: "GOV_VAT",
    });
  });

  it("None → 0", () => {
    expect(defaultWithholdingFor("NONE", "GOODS")).toEqual({
      rate: "0.0000",
      atc: null,
      code: null,
      label: null,
      lineKind: null,
    });
    expect(defaultWithholdingFor("NONE", "SERVICES").rate).toBe("0.0000");
    expect(defaultWithholdingFor("NONE", "GOV_VAT").rate).toBe("0.0000");
  });

  it("unknown or missing type → 0 (never guess)", () => {
    for (const t of [undefined, null, "", "UNKNOWN", "twa"]) {
      expect(defaultWithholdingFor(t, "GOODS")).toEqual({
        rate: "0.0000",
        atc: null,
        code: null,
        label: null,
        lineKind: null,
      });
      expect(needsWithholdingTypeWarning(t)).toBe(true);
    }
    expect(MISSING_WITHHOLDING_TYPE_WARNING).toBe("Set this customer's withholding type");
  });

  it("TWA + GOV_VAT → 0 (not applicable)", () => {
    expect(defaultWithholdingFor("TOP_WITHHOLDING_AGENT", "GOV_VAT").rate).toBe("0.0000");
  });
});

describe("ATC_LABELS config map", () => {
  it("keeps TWA and gov labels in one map; gov marked UNVERIFIED in source", () => {
    expect(ATC_LABELS.WI158).toContain("goods");
    expect(ATC_LABELS.WI160).toContain("services");
    expect(ATC_LABELS.WG010).toMatch(/UNVERIFIED/);
    expect(ATC_LABELS.WV050).toMatch(/UNVERIFIED/);
  });
});

describe("documentWithholdingFromCustomer", () => {
  it("builds TWA document rates from line kinds present", () => {
    expect(documentWithholdingFromCustomer("TOP_WITHHOLDING_AGENT", ["GOODS"]).map((w) => w.code)).toEqual(["GOODS_1"]);
    expect(documentWithholdingFromCustomer("TOP_WITHHOLDING_AGENT", ["SERVICES"]).map((w) => [w.code, w.atcCode])).toEqual([
      ["SERVICES_2", "WI160"],
    ]);
    expect(documentWithholdingFromCustomer("TOP_WITHHOLDING_AGENT", ["GOODS", "SERVICES"]).map((w) => w.code)).toEqual([
      "GOODS_1",
      "SERVICES_2",
    ]);
  });

  it("builds Government document rates; hides Gov VAT when business is non-VAT", () => {
    expect(BUSINESS_IS_VAT_REGISTERED).toBe(false);
    expect(allowGovVatOption()).toBe(false);
    expect(documentWithholdingFromCustomer("GOVERNMENT", ["GOODS"]).map((w) => w.code)).toEqual(["GOV_PT_3"]);
    expect(
      documentWithholdingFromCustomer("GOVERNMENT", ["GOODS"], { includeGovVat: true, businessIsVatRegistered: false }).map((w) => w.code),
    ).toEqual(["GOV_PT_3"]);
    expect(
      documentWithholdingFromCustomer("GOVERNMENT", ["GOODS"], { includeGovVat: true, businessIsVatRegistered: true }).map((w) => w.code),
    ).toEqual(["GOV_PT_3", "GOV_VAT_5"]);
  });

  it("None / unknown → empty document withholding", () => {
    expect(documentWithholdingFromCustomer("NONE", ["GOODS"])).toEqual([]);
    expect(documentWithholdingFromCustomer(undefined, ["GOODS"])).toEqual([]);
  });
});

describe("line snapshot / override helpers", () => {
  it("lineWithholdingSnapshot clears override", () => {
    expect(lineWithholdingSnapshot("TOP_WITHHOLDING_AGENT", "GOODS")).toEqual({
      withholdingRate: "0.0100",
      withholdingAtc: "WI158",
      withholdingOverride: false,
    });
  });

  it("lineDiffersFromUsual matches OVERRIDE_NOTE semantics", () => {
    expect(OVERRIDE_NOTE).toBe("Changed from this customer's usual");
    expect(lineDiffersFromUsual("TOP_WITHHOLDING_AGENT", "GOODS", { rate: "0.0100", atc: "WI158" })).toBe(false);
    expect(lineDiffersFromUsual("TOP_WITHHOLDING_AGENT", "GOODS", { rate: "0.0200", atc: "WI158" })).toBe(true);
    expect(lineDiffersFromUsual("TOP_WITHHOLDING_AGENT", "GOODS", { rate: "0.0100", atc: "WI160" })).toBe(true);
  });
});
