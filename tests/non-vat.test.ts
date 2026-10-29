import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { getGrossSalesYtd, getNonVatMeter, noInvoicesYet, nonVatMeter, taxYearStart, type GrossSalesSource } from "@/lib/services/non-vat";

const taxYear = DEFAULT_SETTINGS.taxYear; // ₱3,000,000, warns at 70% and 90%

/** Test hook: a fake gross-sales source with invoices at given instants. */
function fakeInvoices(rows: { at: string; amount: number }[]): GrossSalesSource & { calls: [Date, Date][] } {
  const calls: [Date, Date][] = [];
  return {
    calls,
    async grossSalesBetween(from, to) {
      calls.push([from, to]);
      return rows.filter((r) => new Date(r.at) >= from && new Date(r.at) < to).reduce((s, r) => s + r.amount, 0);
    },
  };
}

describe("non-VAT threshold meter", () => {
  it("returns ₱0 until invoices exist", async () => {
    expect(await getGrossSalesYtd(2026, new Date("2026-10-30T00:00:00Z"))).toBe(0);
    expect(await noInvoicesYet.grossSalesBetween(new Date(0), new Date())).toBe(0);
    const meter = await getNonVatMeter(taxYear, new Date("2026-10-30T00:00:00Z"));
    expect(meter).toMatchObject({ used: 0, limit: 3_000_000, pct: 0, pctLabel: "0.0%", barPct: 0, level: "ok" });
  });

  it("sums gross sales from Jan 1 (Manila time) of the tax year up to now", async () => {
    const source = fakeInvoices([
      { at: "2025-12-31T15:59:59Z", amount: 999 }, // Dec 31 23:59 Manila: last year
      { at: "2025-12-31T16:00:00Z", amount: 100_000 }, // Jan 1 00:00 Manila: counts
      { at: "2026-06-15T04:00:00Z", amount: 200_000 },
      { at: "2026-11-01T00:00:00Z", amount: 50_000 }, // after "now"
    ]);
    const now = new Date("2026-10-30T00:00:00Z");
    expect(await getGrossSalesYtd(2026, now, source)).toBe(300_000);
    expect(source.calls[0]).toEqual([taxYearStart(2026), now]);
    expect(taxYearStart(2026).toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });

  it("stops at the end of the tax year and is 0 before it starts", async () => {
    const source = fakeInvoices([{ at: "2026-12-31T15:59:59Z", amount: 10 }, { at: "2026-12-31T16:00:00Z", amount: 99 }]);
    expect(await getGrossSalesYtd(2026, new Date("2027-03-01T00:00:00Z"), source)).toBe(10);
    expect(await getGrossSalesYtd(2027, new Date("2026-06-01T00:00:00Z"), source)).toBe(0);
  });

  it("shows the percentage and warns at the 70% and 90% thresholds from settings", () => {
    expect(nonVatMeter(1_500_000, taxYear)).toMatchObject({ pct: 50, pctLabel: "50.0%", level: "ok" });
    expect(nonVatMeter(2_099_999, taxYear)).toMatchObject({ pctLabel: "69.9%", level: "ok" });
    expect(nonVatMeter(2_100_000, taxYear)).toMatchObject({ pctLabel: "70.0%", level: "first" });
    expect(nonVatMeter(2_699_999, taxYear).level).toBe("first");
    expect(nonVatMeter(2_700_000, taxYear)).toMatchObject({ pctLabel: "90.0%", level: "second" });
    expect(nonVatMeter(3_000_000, taxYear)).toMatchObject({ pctLabel: "100.0%", barPct: 100, level: "over" });
    expect(nonVatMeter(3_600_000, taxYear)).toMatchObject({ pct: 120, barPct: 100, level: "over" });
  });

  it("follows changed thresholds and limit in settings", () => {
    const custom = { ...taxYear, nonVatLimit: 1_000_000, warnFirstPct: 50, warnSecondPct: 80 };
    expect(nonVatMeter(499_999, custom).level).toBe("ok");
    expect(nonVatMeter(500_000, custom).level).toBe("first");
    expect(nonVatMeter(800_000, custom).level).toBe("second");
  });

  it("uses an injected source end to end", async () => {
    const source = fakeInvoices([{ at: "2026-03-01T00:00:00Z", amount: 2_800_000 }]);
    const meter = await getNonVatMeter(taxYear, new Date("2026-10-30T00:00:00Z"), source);
    expect(meter).toMatchObject({ used: 2_800_000, level: "second", pctLabel: "93.3%" });
  });
});
