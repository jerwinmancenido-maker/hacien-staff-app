import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/print/amount-in-words";
import { splitWithholdingAcrossCodes } from "@/lib/services/collections";
import { customerSchema } from "@/lib/validation/companies";
import { WITHHOLDING_DEFAULT_ROWS, WITHHOLDING_DEFAULT_CODES } from "@/lib/quotes/withholding-defaults";

describe("S-19 amount in words (title case)", () => {
  it("matches brief examples to the centavo", () => {
    expect(amountInWords("0.01")).toBe("Zero Pesos and 01/100");
    expect(amountInWords("1000000.00")).toBe("One Million Pesos Only");
    expect(amountInWords("81500.75")).toBe("Eighty-One Thousand Five Hundred Pesos and 75/100");
  });
});

describe("S-19 multi-code split", () => {
  it("splits WI640 1% + WI157 2% amounts so cents sum to the total", () => {
    const lines = splitWithholdingAcrossCodes("300.00", [
      { rate: "0.0100", atcCode: "WI640" },
      { rate: "0.0200", atcCode: "WI157" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ atcCode: "WI640", rate: "0.0100", amount: "100.00" });
    expect(lines[1]).toMatchObject({ atcCode: "WI157", rate: "0.0200", amount: "200.00" });
    const sum = lines.reduce((a, l) => a + Number(l.amount), 0);
    expect(sum.toFixed(2)).toBe("300.00");
  });
});

describe("S-19 blank withholding rejected", () => {
  it("server schema refuses null / omitted pick", () => {
    const schema = customerSchema(["Net 30"], ["GOV_GOODS_1"]);
    expect(schema.safeParse({ name: "X", tin: "", withholdingType: "GOVERNMENT", defaultWithholding: null, defaultTerms: "", notes: "" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ name: "X", tin: "", withholdingType: "NONE", defaultWithholding: [], defaultTerms: "", notes: "" }).success).toBe(true);
  });
});

describe("S-19 WB080 not an auto-default", () => {
  it("GOV_PT_3 stays in the catalog for hand pick", () => {
    expect(WITHHOLDING_DEFAULT_ROWS.GOV_PT_3.atcCode).toBe("WB080");
    expect(WITHHOLDING_DEFAULT_CODES.GOV_PT_3).toBe("GOV_PT_3");
    expect(WITHHOLDING_DEFAULT_ROWS.GOV_PT_3.active).toBe(true);
  });
});
