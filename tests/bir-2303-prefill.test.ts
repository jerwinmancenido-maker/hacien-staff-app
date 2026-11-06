// BIR 2303 prefill mapping: structured fields -> form prefill.
// Pure function, no fetch, no component.
import { describe, expect, it } from "vitest";
import { buildPrefill } from "@/lib/2303/prefill";
import type { Structured2303 } from "@/lib/2303/claude";

const high = (value: string | null) => ({ value, confidence: "high" as const });
const low = (value: string | null) => ({ value, confidence: "low" as const });

const fullFields: Structured2303 = {
  registeredName: high("SAMPLE SUNSHINE TRADING INC"),
  tin: high("328-671-896-00001"),
  branchCode: high("00001"),
  registeredAddress: high("Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue, San Roque, Marikina City, Metro Manila 1801"),
  addressStreet: high("Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue"),
  addressBarangay: high("San Roque"),
  addressCity: high("Marikina"),
  addressProvince: high("Metro Manila"),
  addressZip: high("1801"),
  tradeName: high(null),
  rdo: high("043"),
  dateRegistered: high("February 5, 2021"),
};

describe("buildPrefill", () => {
  it("maps the full TIN with branch and every address part", () => {
    const { prefill, filled, leftBlank } = buildPrefill(fullFields);
    expect(prefill.tin).toBe("328-671-896-00001");
    expect(prefill.street).toBe("Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue");
    expect(prefill.barangay).toBe("San Roque");
    expect(prefill.cityMunicipality).toBe("Marikina");
    expect(prefill.province).toBe("Metro Manila");
    expect(prefill.zip).toBe("1801");
    expect(filled.map((f) => f.label)).toEqual(["Name", "TIN", "Address", "Barangay", "City", "Province", "ZIP"]);
    expect(leftBlank).toEqual([]);
  });

  it("keeps the full address string as the street when the parts are missing", () => {
    const { prefill, filled, leftBlank } = buildPrefill({
      ...fullFields,
      addressStreet: low(null),
      addressBarangay: low(null),
      addressCity: low(null),
      addressProvince: low(null),
      addressZip: low(null),
    });
    expect(prefill.street).toBe("Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue, San Roque, Marikina City, Metro Manila 1801");
    expect(prefill.barangay).toBeUndefined();
    expect(prefill.cityMunicipality).toBeUndefined();
    expect(prefill.province).toBeUndefined();
    expect(prefill.zip).toBeUndefined();
    expect(filled.map((f) => f.label)).toEqual(["Name", "TIN", "Address"]);
    expect(leftBlank.join("; ")).toContain("Barangay");
  });

  it("falls back to the full string when the street part is low confidence", () => {
    const { prefill } = buildPrefill({
      ...fullFields,
      addressStreet: low("Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue"),
    });
    expect(prefill.street).toBe("Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue, San Roque, Marikina City, Metro Manila 1801");
    expect(prefill.barangay).toBe("San Roque");
  });

  it("never fills a low-confidence TIN", () => {
    const { prefill, leftBlank } = buildPrefill({ ...fullFields, tin: low("328-671-896-00001") });
    expect(prefill.tin).toBeUndefined();
    expect(leftBlank.join("; ")).toContain("TIN — low confidence");
  });

  it("adds the trade name to notes only when it differs", () => {
    const { prefill } = buildPrefill({ ...fullFields, tradeName: high("Sample Sunshine Retail") });
    expect(prefill.notes).toBe("Trade name: Sample Sunshine Retail");
    const same = buildPrefill({ ...fullFields, tradeName: high("Sample Sunshine Trading Inc") });
    expect(same.prefill.notes).toBeUndefined();
  });
});
