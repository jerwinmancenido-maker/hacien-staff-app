import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canShowHomeSales,
  formatSalesAxisPeso,
  isSalesEmpty,
  lastNMonthKeys,
  manilaMonthKey,
  niceSalesMax,
  owedOverdueChip,
  SALES_AXIS_EMPTY_MAX,
  salesAxisTicks,
  salesChartAxisTicks,
  salesChangeVsLastMonth,
  salesMonthLabel,
  salesMonthsRangeLabel,
  salesVsLastMonthCaption,
  shiftMonthKey,
  topSalesCustomers,
} from "@/lib/home/sales";
import { canShowHomeActivity, filterHomeActivity, activityDetail } from "@/lib/home/activity";
import { newBillingHref, newQuoteHref, auditLogHref } from "@/lib/home/hrefs";
import { roleFlags, can, type PermissionUser } from "@/lib/permissions";

function user(roles: ("ADMIN" | "APPROVER" | "STAFF" | "VIEWER")[], costs = false): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: costs };
}

describe("home sales visibility", () => {
  it("shows Sales only with manage_billing (Admin / Approver)", () => {
    expect(canShowHomeSales(user(["ADMIN"]))).toBe(true);
    expect(canShowHomeSales(user(["APPROVER"]))).toBe(true);
    expect(canShowHomeSales(user(["STAFF"]))).toBe(false);
    expect(canShowHomeSales(user(["VIEWER"]))).toBe(false);
  });
});

describe("home header button permissions", () => {
  it("shows New quote with edit_data and New billing with manage_billing", () => {
    expect(can(user(["ADMIN"]), "edit_data")).toBe(true);
    expect(can(user(["STAFF"]), "edit_data")).toBe(true);
    expect(can(user(["VIEWER"]), "edit_data")).toBe(false);
    expect(can(user(["ADMIN"]), "manage_billing")).toBe(true);
    expect(can(user(["STAFF"]), "manage_billing")).toBe(false);
    expect(newQuoteHref()).toBe("/quotes/new");
    expect(newBillingHref()).toBe("/billing/billings/new");
    expect(auditLogHref()).toBe("/audit");

    const page = readFileSync(path.join(process.cwd(), "src/app/(app)/page.tsx"), "utf8");
    expect(page).toMatch(/newQuoteHref/);
    expect(page).toMatch(/newBillingHref/);
    expect(page).toMatch(/New quote/);
    expect(page).toMatch(/New billing/);
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

  it("builds a Nov 2025 – Oct 2026 range label", () => {
    const months = lastNMonthKeys(new Date("2026-10-31T15:30:00.000Z"), 12).map((key) => ({
      key,
      shortLabel: salesMonthLabel(key, null).short,
    }));
    expect(salesMonthsRangeLabel(months)).toBe("Nov 2025 – Oct 2026");
  });
});

describe("home sales change vs last month (Up/Down/Same chip)", () => {
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

  it("builds the vs caption for the KPI chip row", () => {
    expect(salesVsLastMonthCaption(145_000, "2026-09")).toBe("vs ₱145,000 in Sep");
    expect(salesVsLastMonthCaption("0.00", "2026-01")).toBe("vs ₱0 in Jan");
  });

  it("wires Up chip blue and Down chip grey in the Home sections", () => {
    const sections = readFileSync(path.join(process.cwd(), "src/components/home/HomeSections.tsx"), "utf8");
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(sections).toMatch(/home-chip-up/);
    expect(sections).toMatch(/home-chip-down/);
    expect(css).toMatch(/\.home-chip-up/);
    expect(css).toMatch(/\.home-chip-down/);
  });
});

describe("home owed overdue chip", () => {
  it("shows All overdue when every open billing is past due", () => {
    expect(owedOverdueChip(13, 13)).toEqual({ label: "All overdue", tone: "overdue" });
    expect(owedOverdueChip(5, 5)).toEqual({ label: "All overdue", tone: "overdue" });
  });

  it("shows N overdue when only some are past due", () => {
    expect(owedOverdueChip(3, 10)).toEqual({ label: "3 overdue", tone: "overdue" });
  });

  it("hides the chip when nothing is overdue", () => {
    expect(owedOverdueChip(0, 10)).toBeNull();
    expect(owedOverdueChip(0, 0)).toBeNull();
  });
});

describe("home sales nice Y max", () => {
  it("rounds just above the highest month to a clean value (274K → 300K)", () => {
    expect(niceSalesMax(274_000)).toBe(300_000);
    expect(niceSalesMax(274_000.5)).toBe(300_000);
    expect(niceSalesMax(300_000)).toBe(300_000);
  });

  it("handles zero / empty / non-finite with a sensible default (no NaN)", () => {
    expect(niceSalesMax(0)).toBe(SALES_AXIS_EMPTY_MAX);
    expect(niceSalesMax(-10)).toBe(SALES_AXIS_EMPTY_MAX);
    expect(niceSalesMax(Number.NaN)).toBe(SALES_AXIS_EMPTY_MAX);
    expect(niceSalesMax(Number.POSITIVE_INFINITY)).toBe(SALES_AXIS_EMPTY_MAX);
    expect(Number.isFinite(niceSalesMax(0))).toBe(true);
  });

  it("handles very small and very large values", () => {
    expect(niceSalesMax(1)).toBe(1);
    expect(niceSalesMax(50)).toBe(50);
    expect(niceSalesMax(51)).toBe(60);
    expect(niceSalesMax(999)).toBe(1_000);
    expect(niceSalesMax(1_200_000)).toBe(1_200_000);
    expect(niceSalesMax(1_250_000)).toBe(1_500_000);
    expect(niceSalesMax(9_900_000_000)).toBe(10_000_000_000);
  });

  it("builds three gridlines (⅓, ⅔, top) from the nice max", () => {
    expect(salesAxisTicks(274_000)).toEqual([100_000, 200_000, 300_000]);
    expect(salesAxisTicks(0)).toEqual([
      SALES_AXIS_EMPTY_MAX / 3,
      (2 * SALES_AXIS_EMPTY_MAX) / 3,
      SALES_AXIS_EMPTY_MAX,
    ]);
    // 800K is already nice; 800000 % 3 !== 0 so thirds are floats.
    expect(salesAxisTicks(800_000)).toEqual([800_000 / 3, (2 * 800_000) / 3, 800_000]);
  });
});

describe("home sales axis + empty", () => {
  it("formats grey axis labels like ₱500K / ₱1.0M / ₱274K", () => {
    expect(formatSalesAxisPeso(500_000)).toBe("₱500K");
    expect(formatSalesAxisPeso(1_000_000)).toBe("₱1.0M");
    expect(formatSalesAxisPeso(274_000)).toBe("₱274K");
  });

  it("treats all-zero months as empty", () => {
    expect(isSalesEmpty([{ amount: "0.00" }, { amount: "0" }])).toBe(true);
    expect(isSalesEmpty([{ amount: "0.00" }, { amount: "1.00" }])).toBe(false);
  });

  it("empty state renders no axis amount labels (no ₱1K / ₱500 grid)", () => {
    const ticks = salesAxisTicks(0);
    expect(ticks.length).toBeGreaterThan(0);
    expect(salesChartAxisTicks(true, ticks)).toEqual([]);
    expect(salesChartAxisTicks(false, ticks)).toEqual(ticks);

    const chartSrc = readFileSync(path.join(process.cwd(), "src/components/home/SalesChart.tsx"), "utf8");
    const homeChartSrc = readFileSync(path.join(process.cwd(), "src/components/home/HomeSalesChart.tsx"), "utf8");
    const sections = readFileSync(path.join(process.cwd(), "src/components/home/HomeSections.tsx"), "utf8");
    expect(homeChartSrc).toMatch(/salesChartAxisTicks\(sales\.empty/);
    expect(homeChartSrc).toMatch(/empty=\{sales\.empty\}/);
    expect(chartSrc).toMatch(/showAxis/);
    expect(chartSrc).toMatch(/home-sales-line/);
    expect(sections).toMatch(/No sales billed yet/);
    expect(sections).toMatch(/Go to Billing/);
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

describe("home concept A layout wiring", () => {
  const root = process.cwd();
  const page = readFileSync(path.join(root, "src/app/(app)/page.tsx"), "utf8");
  const dash = readFileSync(path.join(root, "src/lib/home/dashboard.ts"), "utf8");
  const sections = readFileSync(path.join(root, "src/components/home/HomeSections.tsx"), "utf8");
  const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");

  it("uses KPI cards + Sales billed line chart + Needs action; drops Money and Non-VAT sections", () => {
    expect(page).toMatch(/HomeKpiCards/);
    expect(page).toMatch(/HomeSalesSection/);
    expect(page).toMatch(/HomeNeedsAction/);
    expect(page).toMatch(/HomeTaxDeadline/);
    expect(page).toMatch(/HomeRecentActivity/);
    expect(page).not.toMatch(/HomeMoney/);
    expect(page).not.toMatch(/HomeNonVat/);
    expect(sections).not.toMatch(/export function HomeMoney/);
    expect(dash).not.toMatch(/moneyRow\("billedThisMonth"/);
    expect(sections).toMatch(/kpis\.billedThisMonth\.label/);
    expect(sections).toMatch(/Sales billed/);
    expect(sections).toMatch(/Nothing needs action/);
    expect(sections).toMatch(/home-chip-overdue/);
    expect(css).toMatch(/#f8fafc/i);
    expect(css).toMatch(/#e5e7eb/i);
    expect(css).toMatch(/home-sales-line/);
  });

  it("keeps a compact Home: short labels, ~114px chart, 12px gaps, empty NA line", () => {
    expect(dash).toMatch(/Quotes to approve/);
    expect(dash).toMatch(/SOs needing a PO/);
    expect(dash).toMatch(/No WHT type set/);
    expect(dash).toMatch(/No payments yet/);
    expect(dash).not.toMatch(/Customers missing WHT type/);
    expect(dash).not.toMatch(/No payments recorded in/);
    expect(dash).toMatch(/Billed \(\$\{mon\}\)/);
    expect(css).toMatch(/\.home-dashboard\s*\{[^}]*gap:\s*10px/s);
    expect(css).toMatch(/\.home-kp\s*\{[^}]*padding:\s*14px/s);
    expect(css).toMatch(/\.home-sales-svg\s*\{[^}]*height:\s*114px/s);
    expect(css).toMatch(/\.home-na-row\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.home-tax-full\s*\{[^}]*min-height:\s*72px/s);
    const chartSrc = readFileSync(path.join(root, "src/components/home/SalesChart.tsx"), "utf8");
    expect(chartSrc).toMatch(/const VB_H = 114/);
    const hrefs = readFileSync(path.join(root, "src/lib/home/hrefs.ts"), "utf8");
    expect(hrefs).not.toMatch(/billedThisMonthHref/);
  });

  it("compacts Home on phone only (desktop markup/CSS base unchanged)", () => {
    // Phone-only hiding hooks in markup
    expect(sections).toMatch(/home-desktop-only/);
    expect(sections).toMatch(/home-phone-only/);
    expect(sections).toMatch(/home-ks-vs/);
    expect(sections).toMatch(/home-tax-strip/);
    expect(sections).toMatch(/home-ra-row-extra/);
    expect(sections).toMatch(/stripLabel/);
    // Recent: fetch 5 (desktop); phone CSS hides .home-ra-row-extra (3rd+)
    expect(dash).toMatch(/listRecentHomeActivity\(5/);
    // Phone media block: smaller cards (pad 10–12), 18px KPI, 13px titles, 40px taps, no Y-axis, 2 activity rows
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-dashboard\s+\.card\s*\{[^}]*padding:\s*0/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-kp\s*\{[^}]*padding:\s*10px\s+12px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-ct\s*\{[^}]*padding:\s*10px\s+12px\s+0/s);
    // Sales billed + Needs action match KPI 12px padding; chart has no empty band
    expect(css).toMatch(
      /@media \(max-width:\s*640px\)[\s\S]*\.home-sales\s*>\s*\.home-ct[\s\S]*padding:\s*12px\s+12px\s+0/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*640px\)[\s\S]*\.home-na-card\s*>\s*\.home-ct[\s\S]*padding:\s*12px\s+12px\s+0/s,
    );
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-na\s*\{[^}]*padding:\s*0\s+12px\s+12px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-sales-chart\s*\{[^}]*margin:\s*0/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-ct\s+h3\s*\{[^}]*font-size:\s*13px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-kv\s*\{[^}]*font-size:\s*18px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-sales-svg\s*\{[^}]*height:\s*110px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-sales-yl\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-na-row\s*\{[^}]*min-height:\s*40px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-ra-row-extra\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-tax-strip[\s\S]*min-height:\s*48px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*border-radius:\s*10px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*box-shadow:\s*0\s+1px\s+1px/s);
    expect(sections).toMatch(/phoneLimitLabel/);
    // Phone keeps the doc line (e.g. SO-2026-0001 · Sample Corp) with time on the same row
    expect(sections).toMatch(/home-ra-detail/);
    expect(sections).toMatch(/r\.detail/);
    expect(css).toMatch(
      /@media \(max-width:\s*640px\)[\s\S]*\.home-ra-detail\s*\{[^}]*text-overflow:\s*ellipsis/s,
    );
    expect(css).not.toMatch(
      /@media \(max-width:\s*640px\)[\s\S]*\.home-ra-detail\s*\{[^}]*display:\s*none/s,
    );
    expect(page).toMatch(/home-page-header/);
  });

  it("renders up to 5 recent activity rows on desktop; rows past the 2nd carry the phone-hide class", () => {
    expect(dash).toMatch(/listRecentHomeActivity\(5/);
    // Markup: index >= 2 gets home-ra-row-extra (phone CSS hides it below md)
    expect(sections).toMatch(/i\s*>=\s*2\s*\?\s*["'] home-ra-row-extra["']/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.home-ra-row-extra\s*\{[^}]*display:\s*none/s);
    // Desktop base must NOT hide .home-ra-row-extra
    const phoneBlock = css.split(/@media\s*\(\s*max-width:\s*640px\s*\)/)[0] ?? css;
    expect(phoneBlock).not.toMatch(/\.home-ra-row-extra\s*\{[^}]*display:\s*none/s);
  });

  it("prevents sideways overflow on narrow Home (min-width 0 + truncate)", () => {
    expect(css).toMatch(/\.home-dashboard\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.home-dashboard\s+\.card\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.home-bot\s*>\s*\.card[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.home-mid\s*>\s*\.card[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.home-tax-body\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.home-ra-summary\s*\{[^}]*text-overflow:\s*ellipsis/s);
    // Due date wraps fully (no money/date ellipsis); sideways overflow guarded by min-width 0 + shots.
    expect(css).toMatch(/\.home-tax-due\s*\{[^}]*white-space:\s*normal/s);
    expect(css).toMatch(/\.home-pipeline-row-caption\s*\{[^}]*white-space:\s*normal/s);
    expect(css).toMatch(
      /@media \(max-width:\s*640px\)[\s\S]*\.home-pipeline-phone\s*\{[^}]*align-items:\s*stretch/s,
    );
    const shots = readFileSync(path.join(root, "scripts/home-a-shots.mjs"), "utf8");
    expect(shots).toMatch(/scrollWidth/);
    expect(shots).toMatch(/assertNoHorizontalScroll/);
  });

  it("keeps KPI cards equal height, left-aligned, and whole-peso amounts", () => {
    expect(css).toMatch(/\.home-kps\s*\{[^}]*align-items:\s*stretch/s);
    expect(css).toMatch(/\.home-kps\s*>\s*\.card[^}]*margin-top:\s*0/s);
    expect(css).toMatch(/\.home-kv(?:\.num)?\s*\{[^}]*text-align:\s*left/s);
    expect(sections).toMatch(/formatPesoWhole\(kpis\.billedThisMonth\.amount\)/);
    expect(sections).toMatch(/formatPesoWhole\(kpis\.owedByCustomers\.amount\)/);
    expect(sections).toMatch(/formatPesoWhole\(kpis\.collectedThisMonth\.amount\)/);
    expect(sections).toMatch(/formatPesoWhole\(kpis\.billedThisYear\.amount\)/);
    const chartSrc = readFileSync(path.join(root, "src/components/home/SalesChart.tsx"), "utf8");
    expect(chartSrc).toMatch(/formatPesoWhole\(current\.month\.amount\)/);
  });

  it("aligns mid/bot card rows at desktop and shortens the empty chart plot", () => {
    // Mid/bot use start so Needs action / tax do not stretch to the tall neighbor.
    expect(css).toMatch(/\.home-mid\s*\{[^}]*align-items:\s*start/s);
    expect(css).toMatch(/\.home-bot\s*\{[^}]*align-items:\s*start/s);
    expect(css).toMatch(/\.home-mid\s*>\s*\.card[^}]*margin-top:\s*0/s);
    expect(css).toMatch(/\.home-bot\s*>\s*\.card[^}]*margin-top:\s*0/s);
    expect(css).toMatch(/\.home-sales-chart\.is-empty\s+\.home-sales-svg[^}]*height:\s*28px/s);
    const chartSrc = readFileSync(path.join(root, "src/components/home/SalesChart.tsx"), "utf8");
    expect(chartSrc).toMatch(/VB_H_EMPTY/);
    const seed = readFileSync(path.join(root, "scripts/home-a-seed-shots.mjs"), "utf8");
    // Empty seed voids billings (fixture), not just parks invoice dates — so Owed is ₱0.
    expect(seed).toMatch(/EMPTY_VOID_REASON|emptyAllBillings/);
    expect(seed).toMatch(/status:\s*"VOID"/);
  });

  it("staff layout omits sales KPIs/chart and stays full-width without holes", () => {
    expect(page).toMatch(/is-staff/);
    expect(page).toMatch(/home-mid-full|is-staff/);
    expect(css).toMatch(/\.home-dashboard\.is-staff\s+\.home-mid/);
  });
});

describe("home activity cost filter", () => {
  it("hides supplier docs without cost access", () => {
    expect(canShowHomeActivity("PurchaseOrder", false)).toBe(false);
    expect(canShowHomeActivity("ReceivingReport", false)).toBe(false);
    expect(canShowHomeActivity("SupplierBill", false)).toBe(false);
    expect(canShowHomeActivity("Quote", false)).toBe(true);
    expect(canShowHomeActivity("Billing", false)).toBe(true);
    expect(canShowHomeActivity("PurchaseOrder", true)).toBe(true);
  });

  it("filters a mixed activity list down to non-cost rows", () => {
    const rows = [
      { id: "1", entityType: "Quote", summary: "a", detail: null, href: null, entityId: "q", at: new Date(), atLabel: "" },
      { id: "2", entityType: "PurchaseOrder", summary: "b", detail: null, href: null, entityId: "p", at: new Date(), atLabel: "" },
      { id: "3", entityType: "Billing", summary: "c", detail: null, href: null, entityId: "b", at: new Date(), atLabel: "" },
    ];
    expect(filterHomeActivity(rows, false).map((r) => r.entityType)).toEqual(["Quote", "Billing"]);
    expect(filterHomeActivity(rows, true)).toHaveLength(3);
    expect(activityDetail("SO-0007", "Sample Corp")).toBe("SO-0007 · Sample Corp");
  });
});
