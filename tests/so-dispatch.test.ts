import { describe, expect, it } from "vitest";
import { buildDispatchQueue, pageDispatchQueue, type DispatchInputRow } from "@/lib/sales-orders/dispatch";

/**
 * Dispatch queue rules (VR1 Dispatcher finding: "no dispatch queue").
 * Pins the pure builder the /sales-orders/dispatch page renders: remaining
 * quantities come from remainingDeliveryQty (ordered − delivered, clamped
 * at 0), fully delivered / VOID / CLOSED orders are excluded, orders sort
 * oldest first, and the unit totals foot. Today is fixed.
 */
const TODAY = new Date(Date.UTC(2026, 10, 21)); // 2026-11-21

function daysAgo(n: number): Date {
  return new Date(TODAY.getTime() - n * 86_400_000);
}

let seq = 0;
function row(partial: Partial<DispatchInputRow> = {}): DispatchInputRow {
  seq += 1;
  return {
    id: `so-${seq}`,
    number: `SO-2026-${String(seq).padStart(4, "0")}`,
    customerName: "Dispatch Test Customer",
    date: daysAgo(5),
    status: "OPEN",
    deliveryAddress: "1 Test Street",
    contactName: "Test Contact",
    contactPhone: "0917 000 0000",
    lines: [{ description: "Widget", qty: "10.00", deliveredQty: "0.00", unit: "pc" }],
    ...partial,
  };
}

describe("dispatch queue builder", () => {
  it("keeps only the undelivered part of each line", () => {
    const s = buildDispatchQueue(
      [
        row({
          lines: [
            { description: "Widget", qty: "10.00", deliveredQty: "4.00", unit: "pc" },
            { description: "Gadget", qty: "2.00", deliveredQty: "2.00", unit: "pc" },
            { description: "Cable", qty: "3.50", deliveredQty: "1.25", unit: "m" },
          ],
        }),
      ],
      TODAY,
    );
    expect(s.orderCount).toBe(1);
    expect(s.rows[0]!.lines).toEqual([
      { description: "Widget", qtyRemaining: "6.00", unit: "pc" },
      { description: "Cable", qtyRemaining: "2.25", unit: "m" },
    ]);
    expect(s.rows[0]!.unitsRemaining).toBe("8.25");
    expect(s.totalUnitsRemaining).toBe("8.25");
    expect(s.rows[0]!.unitsByUnit).toEqual([
      { unit: "pc", qty: "6.00" },
      { unit: "m", qty: "2.25" },
    ]);
    expect(s.totalByUnit).toEqual([
      { unit: "pc", qty: "6.00" },
      { unit: "m", qty: "2.25" },
    ]);
  });

  it("excludes fully delivered orders", () => {
    const s = buildDispatchQueue(
      [row({ lines: [{ description: "Widget", qty: "5.00", deliveredQty: "5.00", unit: "pc" }] })],
      TODAY,
    );
    expect(s.orderCount).toBe(0);
    expect(s.rows).toEqual([]);
  });

  it("excludes VOID and CLOSED orders even with quantities left", () => {
    const s = buildDispatchQueue([row({ status: "VOID" }), row({ status: "CLOSED" })], TODAY);
    expect(s.orderCount).toBe(0);
  });

  it("clamps an over-delivered line at zero instead of going negative", () => {
    const s = buildDispatchQueue(
      [row({ lines: [{ description: "Widget", qty: "5.00", deliveredQty: "7.00", unit: "pc" }] })],
      TODAY,
    );
    expect(s.orderCount).toBe(0);
  });

  it("sorts oldest first and foots the grand total across orders", () => {
    const s = buildDispatchQueue(
      [
        row({ number: "SO-2026-0100", date: daysAgo(2) }),
        row({
          number: "SO-2026-0099",
          date: daysAgo(40),
          lines: [{ description: "Widget", qty: "4.00", deliveredQty: "1.00", unit: "pc" }],
        }),
      ],
      TODAY,
    );
    expect(s.rows.map((r) => r.number)).toEqual(["SO-2026-0099", "SO-2026-0100"]);
    expect(s.rows[0]!.daysOpen).toBe(40);
    expect(s.totalUnitsRemaining).toBe("13.00");
  });

  it("groups remaining quantities by unit per order and in the summary", () => {
    const s = buildDispatchQueue(
      [
        row({
          number: "SO-2026-0201",
          lines: [
            { description: "Widget", qty: "3.00", deliveredQty: "0.00", unit: "pc" },
            { description: "Cable roll", qty: "1.00", deliveredQty: "0.00", unit: "lot" },
            { description: "Gadget", qty: "2.00", deliveredQty: "0.00", unit: "pc" },
          ],
        }),
        row({
          number: "SO-2026-0202",
          lines: [{ description: "Widget", qty: "4.00", deliveredQty: "1.00", unit: "pc" }],
        }),
      ],
      TODAY,
    );
    const first = s.rows.find((r) => r.number === "SO-2026-0201")!;
    expect(first.unitsByUnit).toEqual([
      { unit: "pc", qty: "5.00" },
      { unit: "lot", qty: "1.00" },
    ]);
    expect(first.unitsRemaining).toBe("6.00");
    expect(s.totalByUnit).toEqual([
      { unit: "pc", qty: "8.00" },
      { unit: "lot", qty: "1.00" },
    ]);
    expect(s.totalUnitsRemaining).toBe("9.00");
  });

  it("handles the empty queue", () => {
    const s = buildDispatchQueue([], TODAY);
    expect(s).toEqual({ rows: [], orderCount: 0, totalUnitsRemaining: "0.00", totalByUnit: [] });
  });
});

describe("dispatch queue paging", () => {
  function bigSummary(n: number) {
    return buildDispatchQueue(Array.from({ length: n }, () => row()), TODAY);
  }

  it("pages the cards while the summary stays whole-queue", () => {
    const s = bigSummary(250);
    expect(s.orderCount).toBe(250);
    expect(s.totalUnitsRemaining).toBe("2500.00");
    const p1 = pageDispatchQueue(s);
    expect(p1.total).toBe(250);
    expect(p1.totalPages).toBe(3);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(100);
    expect(p1.items).toEqual(s.rows.slice(0, 100));
    // Paging reads the summary; it never narrows it.
    expect(s.orderCount).toBe(250);
    expect(s.totalUnitsRemaining).toBe("2500.00");
    expect(s.rows).toHaveLength(250);
  });

  it("page slices tile the whole queue with no gaps or overlaps", () => {
    const s = bigSummary(250);
    const seen: string[] = [];
    const { totalPages } = pageDispatchQueue(s);
    for (let p = 1; p <= totalPages; p++) {
      for (const r of pageDispatchQueue(s, p).items) seen.push(r.id);
    }
    expect(seen).toEqual(s.rows.map((r) => r.id));
    expect(new Set(seen).size).toBe(250);
    expect(pageDispatchQueue(s, 3).items).toHaveLength(50);
  });

  it("clamps a page past the end and treats an invalid page as page 1", () => {
    const s = bigSummary(250);
    expect(pageDispatchQueue(s, 99).page).toBe(3);
    expect(pageDispatchQueue(s, 99).items).toEqual(s.rows.slice(200));
    expect(pageDispatchQueue(s, 0).page).toBe(1);
    expect(pageDispatchQueue(s, Number.NaN).page).toBe(1);
  });

  it("a queue under one page is page 1 of 1", () => {
    const s = bigSummary(12);
    const p1 = pageDispatchQueue(s);
    expect(p1.totalPages).toBe(1);
    expect(p1.items).toEqual(s.rows);
  });
});
