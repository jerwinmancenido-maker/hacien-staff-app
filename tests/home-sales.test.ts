import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canShowHomeSales,
  formatSalesAxisPeso,
  isSalesEmpty,
  lastNMonthKeys,
  manilaMonthKey,
  salesAxisTicks,
  salesChangeVsLastMonth,
  salesMonthLabel,
  shiftMonthKey,
  topSalesCustomers,
} from "@/lib/home/sales";
import { roleFlags, type PermissionUser } from "@/lib/permissions";

function user(roles: ("ADMIN" | "APPROVER" | "STAFF" | "VIEWER")[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

describe("home sales visibility", () => {
  it("shows Sales only with manage_billing (Admin / Approver)", () => {
    expect(canShowHomeSales(user(["ADMIN"]))).toBe(true);
    expect(canShowHomeSales(user(["APPROVER"]))).toBe(true);
    expect(canShowHomeSales(user(["STAFF"]))).toBe(false);
    expect(canShowHomeSales(user(["VIEWER"]))).toBe(false);
  });
});

describe("home sales month windows (Asia/Manila)", () => {
  it("builds the last 12 Manila months including the current month", () => {
    // 2026-10-31 15:30 UTC = Oct 31 23:30 PHT — still October.
    const keys = lastNMonthKeys(new Date("2026-10-31T15:30:00.000Z"), 12);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2025-11");
    expect(keys[keys.length - 1]).toBe("2026-10");
    expect(manilaMonthKey(new Date("2026-10-31T15:30:00.000Z"))).toBe("2026-10");
  });

  it("rolls to the next Manila month after midnight PHT", () => {
    // 2026-10-31 16:00 UTC = Nov 1 00:00 PHT
    expect(manilaMonthKey(new Date("2026-10-31T16:00:00.000Z"))).toBe("2026-11");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("shows the year on the label when the year changes", () => {
    expect(salesMonthLabel("2026-01", "2025-12")).toEqual({
      short: "Jan",
      showYear: true,
      year: 2026,
    });
    expect(salesMonthLabel("2026-02", "2026-01").showYear).toBe(false);
  });
});

describe("home sales change vs last month", () => {
  it("returns an em dash when last month is 0 or data is missing", () => {
    expect(salesChangeVsLastMonth(100, 0)).toEqual({ label: "—", tone: "none" });
    expect(salesChangeVsLastMonth(0, 0)).toEqual({ label: "—", tone: "none" });
    expect(salesChangeVsLastMonth(100, Number.NaN)).toEqual({ label: "—", tone: "none" });
  });

  it("says Up N% when this month is higher", () => {
    expect(salesChangeVsLastMonth(188, 100)).toEqual({ label: "Up 88%", tone: "up" });
    expect(salesChangeVsLastMonth(150, 100)).toEqual({ label: "Up 50%", tone: "up" });
  });

  it("says Down N% when this month is lower", () => {
    expect(salesChangeVsLastMonth(88, 100)).toEqual({ label: "Down 12%", tone: "down" });
    expect(salesChangeVsLastMonth(50, 100)).toEqual({ label: "Down 50%", tone: "down" });
  });

  it("says Same when equal", () => {
    expect(salesChangeVsLastMonth(100, 100)).toEqual({ label: "Same", tone: "flat" });
  });
});

describe("home sales axis + empty", () => {
  it("formats grey axis labels like ₱500K / ₱1.0M", () => {
    expect(formatSalesAxisPeso(500_000)).toBe("₱500K");
    expect(formatSalesAxisPeso(1_000_000)).toBe("₱1.0M");
  });

  it("picks nice ticks from the max month", () => {
    expect(salesAxisTicks(0)).toEqual([0]);
    expect(salesAxisTicks(800_000)).toEqual([500_000, 1_000_000]);
  });

  it("treats all-zero months as empty", () => {
    expect(isSalesEmpty([{ amount: "0.00" }, { amount: "0" }])).toBe(true);
    expect(isSalesEmpty([{ amount: "0.00" }, { amount: "1.00" }])).toBe(false);
  });
});

describe("home sales top customers", () => {
  it("returns top 3 by amount, name-stable on ties, and fewer when short", () => {
    const rows = [
      { customerId: "a", name: "Alpha", amount: "100.00" },
      { customerId: "b", name: "Beta", amount: "300.00" },
      { customerId: "c", name: "Charlie", amount: "300.00" },
      { customerId: "d", name: "Delta", amount: "50.00" },
    ];
    // 300 ties: Beta before Charlie by name; Alpha is 3rd.
    expect(topSalesCustomers(rows, 3).map((r) => r.name)).toEqual(["Beta", "Charlie", "Alpha"]);
    expect(topSalesCustomers(rows.slice(0, 2), 3)).toHaveLength(2);
    expect(topSalesCustomers([], 3)).toEqual([]);
  });
});

describe("home sales wiring", () => {
  const root = process.cwd();
  const page = readFileSync(path.join(root, "src/app/(app)/page.tsx"), "utf8");
  const dash = readFileSync(path.join(root, "src/lib/home/dashboard.ts"), "utf8");
  const sections = readFileSync(path.join(root, "src/components/home/HomeSections.tsx"), "utf8");

  it("places Sales after Needs action and before Money; drops Billed this month from Money", () => {
    expect(page).toMatch(/HomeNeedsAction[\s\S]*HomeSalesSection[\s\S]*HomeMoney/);
    expect(dash).not.toMatch(/moneyRow\("billedThisMonth"/);
    expect(sections).toMatch(/Billed this month/);
    expect(sections).toMatch(/Go to Billing/);
    expect(sections).toMatch(/No sales billed yet/);
  });
});
