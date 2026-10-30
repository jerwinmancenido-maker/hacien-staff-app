import { describe, expect, it } from "vitest";
import {
  ALLOWANCE_8PCT_LABEL,
  ALLOWANCE_8PCT_PESOS,
  COLLECTED_TOTAL_LABEL,
  INCOME_TAX_RATE_8PCT,
  INVOICED_TOTAL_LABEL,
  NON_VAT_THRESHOLD_PESOS,
  OVER_THRESHOLD_WARNING,
  QAP_CSV_FORMAT_LABEL,
  SAWT_CSV_FORMAT_LABEL,
  SUPPLIER_EWT_RDO_NOTE,
  TAX_BASIS_UNVERIFIED_NOTE,
  TAX_WORKSHEET_BANNER,
  TAX_WORKSHEET_PAGES,
} from "@/lib/tax/constants";
import {
  build1701qWorksheet,
  eitherOverThreshold,
  incomeBaseFromTax,
  pesosMaxZeroDiff,
  pesosTimesRate,
  sumPesos,
} from "@/lib/tax/math";
import {
  earlierQuarters,
  latestFinishedQuarter,
  parseTaxQuarter,
  quarterBounds,
  ymdToDate,
} from "@/lib/tax/quarters";
import { customer2307ToSawtCsv, incomeTaxWorksheetToCsv, supplierEwtToQapCsv } from "@/lib/tax/csv";
import { BOOKS_FORBIDDEN_VAT_KEYS, REGISTER_CONFIGS } from "@/lib/books/config";
import { csvCell } from "@/lib/books/registers";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";

function user(roles: Role[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

describe("view_books still gates tax worksheets", () => {
  it("Admin and Approver only", () => {
    expect(can(user(["ADMIN"]), "view_books")).toBe(true);
    expect(can(user(["APPROVER"]), "view_books")).toBe(true);
    expect(can(user(["STAFF"]), "view_books")).toBe(false);
    expect(can(user(["VIEWER"]), "view_books")).toBe(false);
  });
});

describe("quarter boundaries at midnight PHT", () => {
  it("Q1 ends Mar 31; Q2 starts Apr 1", () => {
    const q1 = quarterBounds(2026, 1);
    expect(q1.fromYmd).toBe("2026-01-01");
    expect(q1.toYmd).toBe("2026-03-31");
    expect(q1.yearStartYmd).toBe("2026-01-01");
    expect(ymdToDate(q1.toYmd).toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(quarterBounds(2026, 2).fromYmd).toBe("2026-04-01");
  });

  it("defaults to latest finished quarter", () => {
    const oct = latestFinishedQuarter(new Date("2026-10-30T08:00:00.000Z"));
    expect(oct).toEqual({ year: 2026, quarter: 3 });
    const jan = latestFinishedQuarter(new Date("2026-01-05T08:00:00.000Z"));
    expect(jan).toEqual({ year: 2025, quarter: 4 });
    // 2026-04-01T00:00:00Z = Apr 1 08:00 PHT → Q1 finished
    const apr1 = latestFinishedQuarter(new Date("2026-04-01T00:00:00.000Z"));
    expect(apr1).toEqual({ year: 2026, quarter: 1 });
  });

  it("parseTaxQuarter falls back to latest finished", () => {
    const p = parseTaxQuarter(null, null, new Date("2026-10-30T08:00:00.000Z"));
    expect(p.isDefault).toBe(true);
    expect(p.year).toBe(2026);
    expect(p.quarter).toBe(3);
    const custom = parseTaxQuarter("2026", "2", new Date("2026-10-30T08:00:00.000Z"));
    expect(custom.isDefault).toBe(false);
    expect(custom.fromYmd).toBe("2026-04-01");
    expect(custom.toYmd).toBe("2026-06-30");
  });
});

describe("1701Q worksheet lines (scaled decimals)", () => {
  it("computes a–g and earlier-quarter credit", () => {
    const lines = build1701qWorksheet({
      cumulativeGrossSales: "500000.00",
      taxPaidEarlierQuarters: "10000.00",
      creditableWithholding: "2500.50",
    });
    expect(lines.a).toBe("500000.00");
    expect(lines.b).toBe(ALLOWANCE_8PCT_PESOS);
    expect(lines.c).toBe("250000.00");
    expect(lines.d).toBe("20000.00");
    expect(lines.e).toBe("10000.00");
    expect(lines.f).toBe("2500.50");
    expect(lines.g).toBe("7499.50");
    expect(lines.overThreshold).toBe(false);
    expect(lines.allowanceLabel).toBe(ALLOWANCE_8PCT_LABEL);
    expect(lines.rate).toBe(INCOME_TAX_RATE_8PCT);
  });

  it("₱250k allowance edge: a === allowance → taxable 0; one centavo over → tax base", () => {
    const at = build1701qWorksheet({
      cumulativeGrossSales: "250000.00",
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    expect(at.c).toBe("0.00");
    expect(at.d).toBe("0.00");
    expect(at.g).toBe("0.00");

    const over = build1701qWorksheet({
      cumulativeGrossSales: "250000.01",
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    expect(over.c).toBe("0.01");
    expect(pesosMaxZeroDiff("250000.01", "250000.00")).toBe("0.01");
  });

  it("tax on base uses half-up scaled math (not float)", () => {
    expect(pesosTimesRate("100.00", "0.0800")).toBe("8.00");
    expect(pesosTimesRate("12.55", "0.0800")).toBe("1.00");
    expect(pesosTimesRate("12.57", "0.0800")).toBe("1.01");
  });

  it(">₱3M warning flag when cumulative sales exceed threshold", () => {
    const under = build1701qWorksheet({
      cumulativeGrossSales: NON_VAT_THRESHOLD_PESOS,
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    expect(under.overThreshold).toBe(false);

    const over = build1701qWorksheet({
      cumulativeGrossSales: "3000000.01",
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    expect(over.overThreshold).toBe(true);
    expect(OVER_THRESHOLD_WARNING.toLowerCase()).toContain("3,000,000");
  });

  it("shows invoiced and collected separately — never a combined sales+collections basis", () => {
    const invoiced = build1701qWorksheet({
      cumulativeGrossSales: "500000.00",
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    const collected = build1701qWorksheet({
      cumulativeGrossSales: "200000.00",
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    // Two columns stay distinct; app must not sum them into one chosen "a".
    expect(invoiced.a).toBe("500000.00");
    expect(collected.a).toBe("200000.00");
    expect(sumPesos([invoiced.a, collected.a])).toBe("700000.00");
    expect(eitherOverThreshold("500000.00", "200000.00")).toBe(false);
    expect(eitherOverThreshold("3000000.01", "0.00")).toBe(true);
    expect(eitherOverThreshold("0.00", "3000000.01")).toBe(true);
    expect(TAX_BASIS_UNVERIFIED_NOTE).toBe("Basis UNVERIFIED: accountant to confirm invoiced vs collected.");
    expect(INVOICED_TOTAL_LABEL).toBe("Invoiced total");
    expect(COLLECTED_TOTAL_LABEL).toBe("Collected total");
  });

  it("earlierQuarters lists prior quarters only", () => {
    expect(earlierQuarters(1)).toEqual([]);
    expect(earlierQuarters(3)).toEqual([1, 2]);
    expect(earlierQuarters(4)).toEqual([1, 2, 3]);
  });

  it("income base = tax / rate (scaled)", () => {
    expect(incomeBaseFromTax("1000.00", "0.0100")).toBe("100000.00");
    expect(incomeBaseFromTax("50.00", "0.0200")).toBe("2500.00");
    expect(incomeBaseFromTax("10.00", "0.0000")).toBe("0.00");
  });

  it("sumPesos uses scaled decimals", () => {
    expect(sumPesos(["0.10", "0.20", "0.30"])).toBe("0.60");
  });
});

describe("CSV formats labelled UNVERIFIED; no VAT", () => {
  it("SAWT-style export carries UNVERIFIED label and banner", () => {
    const csv = customer2307ToSawtCsv(
      [
        {
          tin: "000-000-000-000",
          name: "Fake Customer Co",
          atc: "WI010",
          incomeAmount: "10000.00",
          taxWithheld: "100.00",
          status: "Pending",
        },
      ],
      { year: 2026, quarter: 3 },
    );
    expect(csv).toContain(SAWT_CSV_FORMAT_LABEL);
    expect(csv).toContain(TAX_WORKSHEET_BANNER);
    expect(csv.toLowerCase()).not.toMatch(/\bvat\b/);
    expect(csv).toContain("Fake Customer Co");
  });

  it("QAP-style export carries UNVERIFIED label and RDO note", () => {
    const csv = supplierEwtToQapCsv(
      [
        {
          tin: "111-111-111-111",
          name: "Fake Supplier Inc",
          atc: "WC010",
          base: "5000.00",
          rate: "0.0100",
          tax: "50.00",
          month: "2026-03",
        },
      ],
      { year: 2026, quarter: 1 },
    );
    expect(csv).toContain(QAP_CSV_FORMAT_LABEL);
    expect(csv).toContain(SUPPLIER_EWT_RDO_NOTE);
    expect(csv.toLowerCase()).not.toMatch(/\bvat\b/);
  });

  it("1701Q CSV has each line, both bases, UNVERIFIED note, and never VAT", () => {
    const invoiced = build1701qWorksheet({
      cumulativeGrossSales: "400000.00",
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    const collected = build1701qWorksheet({
      cumulativeGrossSales: "150000.00",
      taxPaidEarlierQuarters: "0",
      creditableWithholding: "0",
    });
    const csv = incomeTaxWorksheetToCsv(
      {
        invoicedTotal: invoiced.a,
        collectedTotal: collected.a,
        invoiced,
        collected,
      },
      { year: 2026, quarter: 2, label: "Q2 2026" },
    );
    expect(csv).toContain(TAX_WORKSHEET_BANNER);
    expect(csv).toContain(TAX_BASIS_UNVERIFIED_NOTE);
    expect(csv).toContain("If invoiced");
    expect(csv).toContain("If collected");
    for (const letter of ["a", "b", "c", "d", "e", "f", "g"]) {
      expect(csv).toMatch(new RegExp(`^${letter},`, "m"));
    }
    expect(csv.toLowerCase()).not.toMatch(/\bvat\b/);
  });

  it("CSV formula injection: =, +, -, @, tab, CR get a leading single quote via shared csvCell", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("\tTAB")).toBe("'\tTAB");
    // Shared csvCell (Books): CR gets the apostrophe prefix; quoting only for comma/quote/newline
    expect(csvCell("\rCR")).toBe("'\rCR");
    // Normal values unchanged (aside from quoting when needed)
    expect(csvCell("100.00")).toBe("100.00");
    expect(csvCell("Fake Customer Co")).toBe("Fake Customer Co");

    const sawt = customer2307ToSawtCsv(
      [
        {
          tin: "000-000-000-000",
          name: "=1+1",
          atc: "@SUM(A1)",
          incomeAmount: "100.00",
          taxWithheld: "1.00",
          status: "+cmd",
        },
      ],
      { year: 2026, quarter: 1 },
    );
    expect(sawt).toContain("'=1+1");
    expect(sawt).toContain("'@SUM(A1)");
    expect(sawt).toContain("'+cmd");

    const qap = supplierEwtToQapCsv(
      [
        {
          tin: "111-111-111-111",
          name: "+cmd",
          atc: "=1+1",
          base: "50.00",
          rate: "0.0100",
          tax: "0.50",
          month: "@SUM(A1)",
        },
      ],
      { year: 2026, quarter: 1 },
    );
    expect(qap).toContain("'+cmd");
    expect(qap).toContain("'=1+1");
    expect(qap).toContain("'@SUM(A1)");
  });

  it("Books registers still forbid VAT columns; tax titles never advertise VAT", () => {
    for (const key of Object.keys(REGISTER_CONFIGS) as (keyof typeof REGISTER_CONFIGS)[]) {
      for (const col of REGISTER_CONFIGS[key].columns) {
        for (const bad of BOOKS_FORBIDDEN_VAT_KEYS) {
          expect(col.key.toLowerCase()).not.toContain(bad.toLowerCase().replace(/_/g, ""));
        }
      }
    }
    expect(TAX_WORKSHEET_PAGES.income.title.toLowerCase()).not.toMatch(/\bvat\b/);
  });
});
