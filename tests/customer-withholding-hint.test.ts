import { describe, expect, it } from "vitest";
import { customerWithholdingHint } from "@/lib/quotes/customer-withholding-hint";
import {
  defaultWithholdingFor,
  KNOWN_WITHHOLDING_TYPES,
} from "@/lib/quotes/withholding-defaults";

/** Pull "N% ATC" claims like "1% (WI158)" out of a hint string. */
function claimedRates(hint: string): { pct: number; atc: string }[] {
  const out: { pct: number; atc: string }[] = [];
  const re = /(\d+(?:\.\d+)?)\s*%\s*\(([A-Z0-9]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hint)) != null) {
    const pct = m[1];
    const atc = m[2];
    if (pct == null || atc == null) continue;
    out.push({ pct: Number(pct), atc });
  }
  return out;
}

describe("customerWithholdingHint", () => {
  it("hides the rate hint for GOVERNMENT (no 1%/2% copy that disagrees with 3% WG010)", () => {
    expect(customerWithholdingHint("GOVERNMENT")).toBe("");
    expect(customerWithholdingHint("GOVERNMENT")).not.toMatch(/WI158|WI160|1\s*%|2\s*%/);
  });

  it("every non-empty rate hint matches defaultWithholdingFor for that customer type", () => {
    for (const type of KNOWN_WITHHOLDING_TYPES) {
      const hint = customerWithholdingHint(type);
      const claims = claimedRates(hint);

      if (type === "GOVERNMENT") {
        expect(hint).toBe("");
        expect(claims).toEqual([]);
        continue;
      }

      if (type === "NONE") {
        expect(hint).toBe("No withholding");
        expect(claims).toEqual([]);
        expect(defaultWithholdingFor("NONE", "GOODS").rate).toBe("0.0000");
        expect(defaultWithholdingFor("NONE", "SERVICES").rate).toBe("0.0000");
        continue;
      }

      // TOP_WITHHOLDING_AGENT — every claimed ATC/% must match the pure mapper.
      expect(claims.length).toBeGreaterThan(0);
      for (const claim of claims) {
        const kinds = ["GOODS", "SERVICES"] as const;
        const match = kinds
          .map((k) => defaultWithholdingFor(type, k))
          .find((d) => d.atc === claim.atc && Number(d.rate) * 100 === claim.pct);
        expect(
          match,
          `hint claim ${claim.pct}% (${claim.atc}) for ${type} must match defaultWithholdingFor`,
        ).toBeTruthy();
      }

      // And every non-zero default for GOODS/SERVICES must appear in the hint.
      for (const kind of ["GOODS", "SERVICES"] as const) {
        const d = defaultWithholdingFor(type, kind);
        if (d.rate === "0.0000" || !d.atc) continue;
        const pct = Number(d.rate) * 100;
        expect(hint).toContain(`${pct}%`);
        expect(hint).toContain(`(${d.atc})`);
      }
    }
  });
});
