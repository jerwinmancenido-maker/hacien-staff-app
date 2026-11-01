import { describe, expect, it } from "vitest";
import { currentMonthPeriod } from "@/lib/books/period";
import { addDays, isoDate, manilaToday } from "@/lib/format";
import { activitySummary, documentHref, formatHomeActivityWhen } from "@/lib/home/activity";
import {
  HOME_WITHHOLDING_NOT_SET_LABEL,
  billedYearPhoneLimitLabel,
  buildTaxStripLabel,
  homeMonthBounds,
  homeOwedSplit,
  homeSumAmounts,
  homeTodayPlusDaysYmd,
} from "@/lib/home/dashboard";
import { customersNoWithholdingHref } from "@/lib/home/hrefs";
import { hasOverdueOwed, owedByCustomersSplit, sumPesoAmounts } from "@/lib/home/money";
import { nonVatBarFillClass, nonVatBarTone } from "@/lib/home/nonVatBar";
import {
  formatCompactPesoLimit,
  homeNonVatHelperLine,
  homeNonVatTitle,
} from "@/lib/home/nonVatCopy";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canShowActionRow,
  canShowMoneyFigure,
  isHomeEmpty,
  showSupplierBillsDueSoon,
  showTaxDeadline,
} from "@/lib/home/visibility";
import { roleFlags, type PermissionUser } from "@/lib/permissions";

function user(opts: { roles?: ("ADMIN" | "APPROVER" | "STAFF" | "VIEWER")[]; costs?: boolean; active?: boolean } = {}): PermissionUser {
  const roles = opts.roles ?? ["STAFF"];
  return { ...roleFlags(roles), active: opts.active !== false, canSeeCosts: opts.costs === true };
}

describe("home money figures", () => {
  it("sums peso strings with exact cents", () => {
    expect(sumPesoAmounts([])).toBe("0.00");
    expect(sumPesoAmounts(["10.10", "20.20", "0.03"])).toBe("30.33");
    expect(homeSumAmounts(["100.00", "0.01"])).toBe("100.01");
  });

  it("splits owed vs overdue (overdue never exceeds total)", () => {
    const split = owedByCustomersSplit("1000.00", "250.50");
    expect(split).toEqual({ total: "1000.00", overdue: "250.50", current: "749.50" });
    expect(hasOverdueOwed(split)).toBe(true);
    expect(hasOverdueOwed(owedByCustomersSplit("100.00", "0.00"))).toBe(false);
    expect(homeOwedSplit("50.00", "80.00")).toEqual({ total: "50.00", overdue: "50.00", current: "0.00" });
  });

  it("uses Asia/Manila month bounds (PHT, no DST)", () => {
    // 2026-03-31 20:00 UTC = Apr 1 04:00 PHT → April month
    const april = homeMonthBounds(new Date("2026-03-31T20:00:00.000Z"));
    expect(april.fromYmd).toBe("2026-04-01");
    expect(april.toYmd).toBe("2026-04-30");

    // 2026-04-30 15:59 UTC = Apr 30 23:59 PHT → still April
    const stillApril = currentMonthPeriod(new Date("2026-04-30T15:59:00.000Z"));
    expect(stillApril.fromYmd).toBe("2026-04-01");
    expect(stillApril.toYmd).toBe("2026-04-30");

    // 2026-04-30 16:00 UTC = May 1 00:00 PHT → May
    const may = currentMonthPeriod(new Date("2026-04-30T16:00:00.000Z"));
    expect(may.fromYmd).toBe("2026-05-01");
    expect(may.toYmd).toBe("2026-05-31");
  });

  it("builds due-soon window from Manila today", () => {
    const now = new Date("2026-06-15T10:00:00.000Z");
    expect(isoDate(manilaToday(now))).toBe("2026-06-15");
    expect(homeTodayPlusDaysYmd(7, now)).toBe(isoDate(addDays(manilaToday(now), 7)));
    expect(homeTodayPlusDaysYmd(7, now)).toBe("2026-06-22");
  });
});

describe("home visibility / feature flags", () => {
  const flagsOff = { payablesEnabled: false, cashEnabled: false, booksEnabled: false };
  const flagsPayables = { payablesEnabled: true, cashEnabled: false, booksEnabled: false };
  const flagsCash = { payablesEnabled: false, cashEnabled: true, booksEnabled: false };
  const flagsBooks = { payablesEnabled: false, cashEnabled: false, booksEnabled: true };

  it("hides supplier-bills-due unless PAYABLES or CASH is on", () => {
    expect(showSupplierBillsDueSoon(flagsOff)).toBe(false);
    expect(showSupplierBillsDueSoon(flagsPayables)).toBe(true);
    expect(showSupplierBillsDueSoon(flagsCash)).toBe(true);
  });

  it("hides tax deadline unless Books is on and viewer has view_books", () => {
    expect(showTaxDeadline(flagsBooks, user({ roles: ["ADMIN"], costs: true }))).toBe(true);
    expect(showTaxDeadline(flagsBooks, user({ roles: ["APPROVER"] }))).toBe(true);
    expect(showTaxDeadline(flagsBooks, user({ roles: ["STAFF"] }))).toBe(false);
    expect(showTaxDeadline(flagsOff, user({ roles: ["ADMIN"] }))).toBe(false);
  });

  it("hides cost / margin money figures without canSeeCosts", () => {
    const staff = user({ roles: ["STAFF"], costs: false });
    const costs = user({ roles: ["ADMIN"], costs: true });
    expect(canShowMoneyFigure("supplierBillsDueSoon", staff, flagsPayables)).toBe(false);
    expect(canShowMoneyFigure("supplierBillsDueSoon", costs, flagsPayables)).toBe(true);
    expect(canShowMoneyFigure("owedByCustomers", staff, flagsOff)).toBe(true);
    expect(canShowMoneyFigure("collectedThisMonth", staff, flagsOff)).toBe(true);
    expect(canShowMoneyFigure("supplierBillsDueSoon", costs, flagsOff)).toBe(false);
  });

  it("hides action rows when count is 0, and cost rows without canSeeCosts", () => {
    const staff = user({ costs: false });
    const costs = user({ costs: true });
    expect(canShowActionRow("billingsOverdue", 0, costs)).toBe(false);
    expect(canShowActionRow("billingsOverdue", 2, costs)).toBe(true);
    expect(canShowActionRow("billsOverPo", 3, staff)).toBe(false);
    expect(canShowActionRow("billsOverPo", 3, costs)).toBe(true);
    expect(canShowActionRow("quotesNeedsApproval", 1, staff)).toBe(false);
    expect(canShowActionRow("quotesNeedsApproval", 1, user({ roles: ["APPROVER"] }))).toBe(true);
    expect(canShowActionRow("quotesNeedsApproval", 1, user({ roles: ["ADMIN"], costs: true }))).toBe(true);
  });

  it("treats zero customers as the empty / getting-started state", () => {
    expect(isHomeEmpty(0)).toBe(true);
    expect(isHomeEmpty(1)).toBe(false);
  });
});

describe("home getting-started hrefs", () => {
  it("points at new customer then new quote", async () => {
    const { newCustomerHref, newQuoteHref } = await import("@/lib/home/hrefs");
    expect(newCustomerHref()).toBe("/customers/new");
    expect(newQuoteHref()).toBe("/quotes/new");
  });
});

describe("home action count cap", () => {
  it("shows 200+ when the list page cap is hit", async () => {
    const { formatHomeActionCount, HOME_ACTION_COUNT_CAP } = await import("@/lib/home/actionCount");
    expect(HOME_ACTION_COUNT_CAP).toBe(200);
    expect(formatHomeActionCount(0)).toBe("0");
    expect(formatHomeActionCount(199)).toBe("199");
    expect(formatHomeActionCount(200)).toBe("200+");
    expect(formatHomeActionCount(350)).toBe("200+");
  });
});

describe("home Needs action — Withholding not set", () => {
  it("uses pick-not-set wording and links to the matching customer list", () => {
    expect(HOME_WITHHOLDING_NOT_SET_LABEL).toBe("Withholding not set");
    expect(HOME_WITHHOLDING_NOT_SET_LABEL).not.toMatch(/WHT type|withholding type/i);
    expect(customersNoWithholdingHref()).toBe("/customers?wh=NOT_SET");
  });
});

describe("home Non-VAT card copy", () => {
  it("formats the settings limit compactly in the home title and sidebar label", () => {
    expect(formatCompactPesoLimit(3_000_000)).toBe("₱3M");
    expect(formatCompactPesoLimit(1_500_000)).toBe("₱1.5M");
    expect(homeNonVatTitle(3_000_000)).toBe("Non-VAT sales limit (₱3M)");
    expect(homeNonVatTitle(1_500_000)).toBe("Non-VAT sales limit (₱1.5M)");
    // Same helper used for the sidebar tracker label.
    expect(homeNonVatTitle(3_000_000)).toContain(formatCompactPesoLimit(3_000_000));
    expect(homeNonVatTitle(1_500_000)).toContain(formatCompactPesoLimit(1_500_000));
  });

  it("never emits 1000K / 1000M and always keeps the ₱ sign at unit boundaries", () => {
    expect(formatCompactPesoLimit(999_949)).toBe("₱999.9K");
    expect(formatCompactPesoLimit(999_999)).toBe("₱1.0M");
    expect(formatCompactPesoLimit(1_000_000)).toBe("₱1M");
    expect(formatCompactPesoLimit(999_999_999)).toBe("₱1.0B");
    for (const n of [999_949, 999_999, 1_000_000, 999_999_999]) {
      expect(formatCompactPesoLimit(n).startsWith("₱")).toBe(true);
      expect(formatCompactPesoLimit(n)).not.toMatch(/1000K|1000M|P\d/);
    }
  });

  it("uses settings-driven warn percents in the helper", () => {
    expect(homeNonVatHelperLine(70, 90)).toBe(
      "Estimate based on invoices in this app for this year. Your accountant's books are the official count. Warns at 70% and 90%.",
    );
    expect(homeNonVatHelperLine(50, 80)).toContain("Warns at 50% and 80%.");
  });
});

describe("home Non-VAT bar tone", () => {
  it("uses accent below warn %, warning at first threshold, danger at second/over", () => {
    expect(nonVatBarTone("ok")).toBe("accent");
    expect(nonVatBarTone("first")).toBe("warning");
    expect(nonVatBarTone("second")).toBe("danger");
    expect(nonVatBarTone("over")).toBe("danger");
    expect(nonVatBarFillClass("ok")).toBe("");
    expect(nonVatBarFillClass("first")).toBe(" amber");
    expect(nonVatBarFillClass("second")).toBe(" red");
    expect(nonVatBarFillClass("over")).toBe(" red");
  });

  it("wires accent fill to var(--blue) in globals.css for home + sidebar meters", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/--blue:\s*#2563eb;/i);
    expect(css).toMatch(/\.home-nonvat\s+\.aging-bar-fill:not\(\.empty\)\s*\{[^}]*background:\s*var\(--blue\)/s);
    expect(css).toMatch(/\.bar\s*>\s*span\s*\{[^}]*background:\s*var\(--blue\)/s);
    expect(css).toMatch(/\.tracker-card\.level-first\s+\.bar\s*>\s*span\s*\{[^}]*background:\s*var\(--amber\)/s);
    expect(css).toMatch(/\.home-nonvat\s+\.aging-bar-fill\.amber\s*\{[^}]*background:\s*var\(--amber\)/s);
  });
});

describe("home activity helpers", () => {
  it("builds plain-language summaries and document hrefs", () => {
    expect(activitySummary("create", "Quote", "Jerwin")).toBe("Jerwin created a quote");
    expect(activitySummary("void", "Billing", null)).toBe("Someone voided a billing");
    expect(documentHref("Quote", "q1")).toBe("/quotes/q1");
    expect(documentHref("ReceivingReport", "rr1", { purchaseOrderId: "po1" })).toBe("/receiving/po1");
    expect(documentHref("SupplierBill", "b1", { purchaseOrderId: "po1" })).toBe("/purchase-orders/po1?tab=bills");
    expect(documentHref("SupplierBill", "b1")).toBeNull();
  });

  it("formats compact Manila activity times (time today; date + time otherwise)", () => {
    // 2026-10-31 09:49 UTC = 5:49 PM PHT
    const at = new Date("2026-10-31T09:49:00.000Z");
    const sameDay = new Date("2026-10-31T02:00:00.000Z"); // still Oct 31 PHT
    const nextDay = new Date("2026-11-01T02:00:00.000Z"); // Nov 1 PHT
    expect(formatHomeActivityWhen(at, sameDay)).toBe("5:49 PM");
    expect(formatHomeActivityWhen(at, nextDay)).toBe("Oct 31, 5:49 PM");
  });
});

describe("home tax phone strip label", () => {
  it("builds NOV 16 · 1701Q due in N days from computed fields (not hard-coded)", () => {
    // Manila "today" 2026-10-31 → due 2026-11-16 is 16 days out.
    const now = new Date("2026-10-31T04:00:00.000Z");
    expect(
      buildTaxStripLabel({
        form: "1701Q",
        badgeMonth: "NOV",
        badgeDay: "16",
        dueYmd: "2026-11-16",
        now,
      }),
    ).toBe("NOV 16 · 1701Q due in 16 days");
    expect(
      buildTaxStripLabel({
        form: "1701Q",
        badgeMonth: "NOV",
        badgeDay: "16",
        dueYmd: "2026-10-31",
        now,
      }),
    ).toBe("NOV 16 · 1701Q due today");
  });
});

describe("home billed-year phone limit label", () => {
  it("joins live pctLabel with compact Non-VAT limit (not hard-coded 46.8)", () => {
    expect(billedYearPhoneLimitLabel("46.8%", 3_000_000)).toBe("46.8% of ₱3M limit");
    expect(billedYearPhoneLimitLabel("0.0%", 3_000_000)).toBe("0.0% of ₱3M limit");
    expect(billedYearPhoneLimitLabel("50.0%", 1_500_000)).toBe("50.0% of ₱1.5M limit");
    // Uses the same compact formatter as the Non-VAT title / sidebar.
    expect(billedYearPhoneLimitLabel("10.0%", 3_000_000)).toContain(formatCompactPesoLimit(3_000_000));
    expect(billedYearPhoneLimitLabel("10.0%", 3_000_000)).not.toMatch(/^46\.8/);
  });
});

describe("home concept A staff / empty wiring", () => {
  it("page gates sales KPIs and chart on manage_billing and keeps staff layout full", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(app)/page.tsx"), "utf8");
    expect(page).toMatch(/showSales/);
    expect(page).toMatch(/is-staff/);
    expect(page).toMatch(/HomeKpiCards/);
    expect(page).toMatch(/HomeNeedsAction/);
    expect(page).not.toMatch(/HomeMoney/);
    expect(page).not.toMatch(/HomeNonVat/);
    // Needs action always renders (short empty line when all counts are 0).
    expect(page).not.toMatch(/hasMid/);
  });
});
