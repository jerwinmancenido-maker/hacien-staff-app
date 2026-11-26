// Company Profile slice 3 (screens + Books/CSV): every screen/CSV company
// name, posture text and export filename now derives from the settings
// snapshot. With the seeded values the derivations must reproduce today's
// strings byte-for-byte; with a dummy profile they must follow the profile.
import { describe, expect, it } from "vitest";
import { settingsSchema, type Settings } from "@/lib/settings/schema";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { appIdentity, csvDownloadName, FALLBACK_SHORT_NAME } from "@/lib/settings/identity";
import {
  BUSINESS_IS_VAT_REGISTERED,
  NON_VAT_THRESHOLD_PESOS,
  OVER_THRESHOLD_WARNING,
  SUPPLIER_EWT_RDO_NOTE,
  TAX_WORKSHEET_DISCLAIMER,
  overThresholdWarning,
  supplierEwtRdoNote,
  taxWorksheetDisclaimer,
} from "@/lib/tax/constants";
import { BOOKS_DISCLAIMER, booksDisclaimer } from "@/lib/books/config";
import { TAX_CALENDAR_ICS_NAME, taxCalendarIcsName } from "@/lib/tax/calendar-constants";
import { profitToCsv, type MonthlyProfit } from "@/lib/services/profit";
import { operationalProfitToCsv, type OperationalProfit } from "@/lib/services/reconciliation";
import { supplierEwtToQapCsv } from "@/lib/tax/csv";

const dummy: Settings = settingsSchema.parse({
  ...DEFAULT_SETTINGS,
  company: { ...DEFAULT_SETTINGS.company, name: "ACME TEST CO" },
  identity: { ...DEFAULT_SETTINGS.identity, appShortName: "ACME", csvFilePrefix: "acme" },
  taxYear: { ...DEFAULT_SETTINGS.taxYear, nonVatLimit: 5000000, isVatRegistered: true },
});

describe("appIdentity", () => {
  it("seeded values reproduce today's chrome strings", () => {
    expect(appIdentity(DEFAULT_SETTINGS)).toEqual({
      title: "HACIEN Staff",
      shortName: "HACIEN",
      companyName: "HACIEN",
      csvFilePrefix: "hacien",
    });
    expect(FALLBACK_SHORT_NAME).toBe("HACIEN");
  });

  it("follows a dummy profile", () => {
    const id = appIdentity(dummy);
    expect(id.companyName).toBe("ACME TEST CO");
    expect(id.shortName).toBe("ACME");
    expect(id.csvFilePrefix).toBe("acme");
  });
});

describe("csvDownloadName (F12)", () => {
  it("seeded prefix reproduces all nine historical filenames", () => {
    const p = DEFAULT_SETTINGS.identity.csvFilePrefix;
    expect(csvDownloadName(p, "sales-2026-01-01_to_2026-01-31.csv")).toBe("hacien-sales-2026-01-01_to_2026-01-31.csv");
    expect(csvDownloadName(p, "profit-2026-11.csv")).toBe("hacien-profit-2026-11.csv");
    expect(csvDownloadName(p, "reconciliation-all-all-2026-11-27.csv")).toBe("hacien-reconciliation-all-all-2026-11-27.csv");
    expect(csvDownloadName(p, "operations-2026-11.csv")).toBe("hacien-operations-2026-11.csv");
    expect(csvDownloadName(p, "sales-summary-2026.csv")).toBe("hacien-sales-summary-2026.csv");
    expect(csvDownloadName(p, "1701q-8pct-Q3-2026.csv")).toBe("hacien-1701q-8pct-Q3-2026.csv");
    expect(csvDownloadName(p, "qap-unverified-Q3-2026.csv")).toBe("hacien-qap-unverified-Q3-2026.csv");
    expect(csvDownloadName(p, "sawt-unverified-Q3-2026.csv")).toBe("hacien-sawt-unverified-Q3-2026.csv");
    expect(csvDownloadName(p, "marketing-consent-opted-in.csv")).toBe("hacien-marketing-consent-opted-in.csv");
  });

  it("follows a dummy prefix and drops the dash on a blank prefix", () => {
    expect(csvDownloadName("acme", "profit-2026-11.csv")).toBe("acme-profit-2026-11.csv");
    expect(csvDownloadName("", "profit-2026-11.csv")).toBe("profit-2026-11.csv");
  });
});

describe("tax posture derivations (F5)", () => {
  it("seeded derivations equal the historical constants byte-for-byte", () => {
    expect(taxWorksheetDisclaimer(DEFAULT_SETTINGS.identity.appShortName, DEFAULT_SETTINGS.taxYear.isVatRegistered)).toBe(
      TAX_WORKSHEET_DISCLAIMER,
    );
    expect(overThresholdWarning(DEFAULT_SETTINGS.taxYear.nonVatLimit)).toBe(OVER_THRESHOLD_WARNING);
    expect(supplierEwtRdoNote(DEFAULT_SETTINGS.identity.appShortName)).toBe(SUPPLIER_EWT_RDO_NOTE);
    expect(BUSINESS_IS_VAT_REGISTERED).toBe(DEFAULT_SETTINGS.taxYear.isVatRegistered);
    expect(NON_VAT_THRESHOLD_PESOS).toBe(DEFAULT_SETTINGS.taxYear.nonVatLimit.toFixed(2));
    expect(NON_VAT_THRESHOLD_PESOS).toBe("3000000.00");
  });

  it("follow a dummy posture and threshold", () => {
    expect(taxWorksheetDisclaimer(dummy.identity.appShortName, true)).toBe(
      "Preparation aid for the owner and accountant. ACME is VAT-registered — VAT is shown where it applies.",
    );
    expect(overThresholdWarning(5000000)).toContain("5,000,000");
    expect(supplierEwtRdoNote(dummy.identity.appShortName)).toContain("Only applies if ACME is registered to withhold");
  });
});

describe("books disclaimer derivation (F5)", () => {
  it("seeded derivation equals the historical constant", () => {
    expect(booksDisclaimer(DEFAULT_SETTINGS.identity.appShortName, DEFAULT_SETTINGS.taxYear.isVatRegistered)).toBe(BOOKS_DISCLAIMER);
  });

  it("follows a dummy name and VAT posture", () => {
    expect(booksDisclaimer("ACME", false)).toContain("ACME is non-VAT");
    expect(booksDisclaimer("ACME", true)).toContain("ACME is VAT-registered");
  });
});

describe("CSV in-file labels follow the company name (F9)", () => {
  const profit: MonthlyProfit = {
    month: "2026-11",
    revenue: "90000.00",
    customerReturns: "5000.00",
    supplierBills: "67000.00",
    supplierReturns: "3000.00",
    expenses: "0.00",
    net: "28000.00",
    deals: [],
  };

  it("profit CSV title row", () => {
    expect(profitToCsv(profit).startsWith("HACIEN monthly profit,2026-11\n")).toBe(true);
    expect(profitToCsv(profit, "ACME").startsWith("ACME monthly profit,2026-11\n")).toBe(true);
  });

  const ops: OperationalProfit = {
    month: "2026-11",
    rows: [
      { businessId: null, label: "HACIEN", sales: "100.00", supplierCosts: "40.00", expenses: "0.00", profit: "60.00", orderCount: 1 },
    ],
    combined: { businessId: null, label: "All businesses", sales: "100.00", supplierCosts: "40.00", expenses: "0.00", profit: "60.00", orderCount: 1 },
    officialBilledRevenue: "100.00",
    officialNet: "60.00",
    bridge: {
      recordedSales: "100.00",
      recordedProfit: "60.00",
      unbilled: "0.00",
      recordedCosts: "40.00",
      supplierBills: "40.00",
      costsVsBills: "0.00",
    },
  };

  it("operations CSV bridge labels", () => {
    expect(operationalProfitToCsv(ops)).toContain("(Books, HACIEN only)");
    const csv = operationalProfitToCsv(ops, "ACME");
    expect(csv).toContain("(Books, ACME only)");
    expect(csv).not.toContain("(Books, HACIEN only)");
  });

  it("QAP note names the company", () => {
    const rows = [
      { tin: "111-111-111-111", name: "Fake Supplier Inc", atc: "WC010", base: "5000.00", rate: "0.0100", tax: "50.00", month: "2026-03" },
    ];
    expect(supplierEwtToQapCsv(rows, { year: 2026, quarter: 1 })).toContain(`# Note: ${SUPPLIER_EWT_RDO_NOTE}`);
    expect(supplierEwtToQapCsv(rows, { year: 2026, quarter: 1, shortName: "ACME" })).toContain(
      "# Note: Only applies if ACME is registered to withhold — confirm with RDO.",
    );
  });
});

describe("ICS calendar name (F5)", () => {
  it("seeded derivation equals the historical constant", () => {
    expect(taxCalendarIcsName(DEFAULT_SETTINGS.identity.appShortName)).toBe(TAX_CALENDAR_ICS_NAME);
  });

  it("follows a dummy short name", () => {
    expect(taxCalendarIcsName("ACME")).toBe("ACME tax deadlines (provisional)");
  });
});
