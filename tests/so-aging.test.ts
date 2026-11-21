import { describe, expect, it } from "vitest";
import { buildSoAging, type SoAgingInputRow } from "@/lib/sales-orders/aging";

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
