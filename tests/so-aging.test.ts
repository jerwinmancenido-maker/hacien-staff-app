import { describe, expect, it } from "vitest";
import { buildSoAging, filterSoAging, pageSoAging, type SoAgingInputRow, type SoAgingSummary } from "@/lib/sales-orders/aging";

/**
 * SO aging bucketing (VR1 CEO finding: "no aging anywhere" for sales orders).
 * Pins the pure builder the /sales-orders/aging page renders: the band edges
 * are the AR aging bands (billing/aging.ts) applied to days since the SO
 * date, fully billed / VOID / CLOSED orders are excluded, and the band and
 * grand totals foot. Dates are DATE-style (00:00 UTC), today is fixed.
 */
const TODAY = new Date(Date.UTC(2026, 10, 21)); // 2026-11-21

function daysAgo(n: number): Date {
  return new Date(TODAY.getTime() - n * 86_400_000);
}

let seq = 0;
function row(partial: Partial<SoAgingInputRow> = {}): SoAgingInputRow {
  seq += 1;
  return {
    id: `so-${seq}`,
    number: `SO-2026-${String(seq).padStart(4, "0")}`,
    customerName: "Aging Test Customer",
    date: daysAgo(10),
    status: "OPEN",
    contractPrice: "1000.00",
    billedAmounts: [],
    ...partial,
  };
}

describe("SO aging bucketing", () => {
  it("puts an order in the AR band matching its age in days", () => {
    const cases: [number, string][] = [
      [0, "current"],
      [1, "d1_30"],
      [30, "d1_30"],
      [31, "d31_60"],
      [60, "d31_60"],
      [61, "d61_90"],
      [90, "d61_90"],
      [91, "d90_plus"],
      [200, "d90_plus"],
    ];
    for (const [days, bucket] of cases) {
      const s = buildSoAging([row({ date: daysAgo(days) })], TODAY);
      expect(s.orderCount, `days=${days}`).toBe(1);
      expect(s.bands).toHaveLength(1);
      expect(s.bands[0]!.bucket, `days=${days}`).toBe(bucket);
      expect(s.bands[0]!.rows[0]!.daysOpen, `days=${days}`).toBe(days);
    }
  });

  it("excludes fully billed and over-billed orders", () => {
    const s = buildSoAging(
      [
        row({ billedAmounts: ["1000.00"] }),
        row({ billedAmounts: ["600.00", "400.00"] }),
        row({ billedAmounts: ["1200.00"] }),
        row({ billedAmounts: ["999.99"] }),
      ],
      TODAY,
    );
    expect(s.orderCount).toBe(1);
    expect(s.totalLeftToBill).toBe("0.01");
  });

  it("excludes VOID and CLOSED orders even with money left to bill", () => {
    const open = row({ status: "OPEN" });
    const s = buildSoAging([row({ status: "VOID" }), row({ status: "CLOSED" }), open], TODAY);
    expect(s.orderCount).toBe(1);
    expect(s.bands[0]!.rows[0]!.number).toBe(open.number);
  });

  it("splits billed vs left to bill across several billings", () => {
    const s = buildSoAging([row({ contractPrice: "5450.00", billedAmounts: ["2000.00", "1450.00"] })], TODAY);
    const r = s.bands[0]!.rows[0]!;
    expect(r.billed).toBe("3450.00");
    expect(r.leftToBill).toBe("2000.00");
    expect(r.contractPrice).toBe("5450.00");
  });

  it("foots band totals and the grand total", () => {
    const s = buildSoAging(
      [
        row({ date: daysAgo(5), contractPrice: "1000.00", billedAmounts: ["250.00"] }),
        row({ date: daysAgo(20), contractPrice: "2000.00", billedAmounts: [] }),
        row({ date: daysAgo(100), contractPrice: "500.00", billedAmounts: ["100.00"] }),
      ],
      TODAY,
    );
    expect(s.orderCount).toBe(3);
    expect(s.bands.map((b) => b.bucket)).toEqual(["d1_30", "d90_plus"]);
    const young = s.bands[0]!;
    expect(young.contractPrice).toBe("3000.00");
    expect(young.billed).toBe("250.00");
    expect(young.leftToBill).toBe("2750.00");
    expect(s.bands[1]!.leftToBill).toBe("400.00");
    expect(s.totalContractPrice).toBe("3500.00");
    expect(s.totalBilled).toBe("350.00");
    expect(s.totalLeftToBill).toBe("3150.00");
  });

  it("orders rows oldest first inside a band", () => {
    const s = buildSoAging([row({ date: daysAgo(3) }), row({ date: daysAgo(28) }), row({ date: daysAgo(12) })], TODAY);
    expect(s.bands[0]!.rows.map((r) => r.daysOpen)).toEqual([28, 12, 3]);
  });

  it("is empty when nothing is aging", () => {
    const s = buildSoAging([], TODAY);
    expect(s.orderCount).toBe(0);
    expect(s.bands).toEqual([]);
    expect(s.totalLeftToBill).toBe("0.00");
  });
});

describe("SO aging paging", () => {
  /** 100 orders 10 days old (d1_30) + 150 orders 100 days old (d90_plus). */
  function bigSummary(): SoAgingSummary {
    const rows: SoAgingInputRow[] = [];
    for (let i = 0; i < 100; i++) rows.push(row({ date: daysAgo(10) }));
    for (let i = 0; i < 150; i++) rows.push(row({ date: daysAgo(100) }));
    return buildSoAging(rows, TODAY);
  }
  const flat = (s: SoAgingSummary) => s.bands.flatMap((b) => b.rows);

  it("bands carry their whole-band row count", () => {
    const s = bigSummary();
    expect(s.bands.map((b) => [b.bucket, b.rowCount, b.rows.length])).toEqual([
      ["d1_30", 100, 100],
      ["d90_plus", 150, 150],
    ]);
  });

  it("pages the band tables while the summary stays whole-set", () => {
    const s = bigSummary();
    const p1 = pageSoAging(s);
    expect(p1.total).toBe(250);
    expect(p1.totalPages).toBe(3);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(100);
    expect(p1.items).toEqual(flat(s).slice(0, 100));
    // Page 1 is exactly the first band; the second band starts on page 2.
    expect(p1.bands.map((b) => b.bucket)).toEqual(["d1_30"]);
    // Paging reads the summary; it never narrows it.
    expect(s.orderCount).toBe(250);
    expect(s.totalLeftToBill).toBe("250000.00");
    expect(s.bands.map((b) => b.rows.length)).toEqual([100, 150]);
  });

  it("page slices tile the whole aging set with no gaps or overlaps", () => {
    const s = bigSummary();
    const seen: string[] = [];
    const { totalPages } = pageSoAging(s);
    for (let p = 1; p <= totalPages; p++) {
      for (const r of pageSoAging(s, p).items) seen.push(r.id);
    }
    expect(seen).toEqual(flat(s).map((r) => r.id));
    expect(new Set(seen).size).toBe(250);
    expect(pageSoAging(s, 3).items).toHaveLength(50);
  });

  it("a band spanning pages keeps whole-band totals and count on every page", () => {
    const s = bigSummary();
    const whole = s.bands[1]!;
    for (const p of [2, 3]) {
      const band = pageSoAging(s, p).bands.find((b) => b.bucket === "d90_plus")!;
      expect(band.contractPrice).toBe(whole.contractPrice);
      expect(band.billed).toBe(whole.billed);
      expect(band.leftToBill).toBe(whole.leftToBill);
      expect(band.rowCount).toBe(150);
    }
    expect(pageSoAging(s, 2).bands[0]!.rows).toHaveLength(100);
    expect(pageSoAging(s, 3).bands[0]!.rows).toHaveLength(50);
    // The figures the header cards and grand total render never move.
    expect(s.totalContractPrice).toBe("250000.00");
    expect(s.totalBilled).toBe("0.00");
    expect(s.totalLeftToBill).toBe("250000.00");
  });

  it("clamps a page past the end and treats an invalid page as page 1", () => {
    const s = bigSummary();
    expect(pageSoAging(s, 99).page).toBe(3);
    expect(pageSoAging(s, 99).items).toEqual(flat(s).slice(200));
    expect(pageSoAging(s, 0).page).toBe(1);
    expect(pageSoAging(s, Number.NaN).page).toBe(1);
  });

  it("a set under one page is page 1 of 1 with bands untouched", () => {
    const s = buildSoAging([row({ date: daysAgo(5) }), row({ date: daysAgo(100) })], TODAY);
    const p1 = pageSoAging(s);
    expect(p1.totalPages).toBe(1);
    expect(p1.bands).toEqual(s.bands);
    expect(p1.items).toEqual(flat(s));
  });
});

describe("SO aging search + band filter (finding 1300)", () => {
  function filteredSummary() {
    return buildSoAging(
      [
        row({ number: "SO-2026-0101", customerName: "Alpha Trading", date: daysAgo(10), contractPrice: "1000.00" }),
        row({ number: "SO-2026-0102", customerName: "Beta Corp", date: daysAgo(10), contractPrice: "2000.00", billedAmounts: ["500.00"] }),
        row({ number: "SO-2026-0103", customerName: "Alpha Trading", date: daysAgo(45), contractPrice: "4000.00" }),
        row({ number: "SO-2026-0104", customerName: "Gamma LLC", date: daysAgo(100), contractPrice: "8000.00" }),
      ],
      TODAY,
    );
  }

  it("narrows by customer name, case-insensitive, and recomputes the totals", () => {
    const view = filterSoAging(filteredSummary(), "alpha");
    expect(view.orderCount).toBe(2);
    expect(view.bands.map((b) => b.bucket)).toEqual(["d1_30", "d31_60"]);
    expect(view.totalLeftToBill).toBe("5000.00");
    expect(view.totalContractPrice).toBe("5000.00");
    expect(view.bands[0]!.rowCount).toBe(1);
  });

  it("narrows by SO number fragment", () => {
    const view = filterSoAging(filteredSummary(), "0102");
    expect(view.orderCount).toBe(1);
    expect(view.bands[0]!.rows[0]!.number).toBe("SO-2026-0102");
    expect(view.totalLeftToBill).toBe("1500.00");
  });

  it("band filter keeps only that band, with or without a query", () => {
    const s = filteredSummary();
    const bandOnly = filterSoAging(s, undefined, "d90_plus");
    expect(bandOnly.orderCount).toBe(1);
    expect(bandOnly.bands).toHaveLength(1);
    expect(bandOnly.totalLeftToBill).toBe("8000.00");
    const both = filterSoAging(s, "alpha", "d90_plus");
    expect(both.orderCount).toBe(0);
    expect(both.bands).toEqual([]);
  });

  it("no query and no band returns the summary unchanged; a blank query does too", () => {
    const s = filteredSummary();
    expect(filterSoAging(s)).toBe(s);
    expect(filterSoAging(s, "   ")).toBe(s);
  });

  it("a query with no matches empties the view but leaves the source intact", () => {
    const s = filteredSummary();
    const view = filterSoAging(s, "no-such-customer");
    expect(view.orderCount).toBe(0);
    expect(view.totalLeftToBill).toBe("0.00");
    expect(s.orderCount).toBe(4);
  });
});
