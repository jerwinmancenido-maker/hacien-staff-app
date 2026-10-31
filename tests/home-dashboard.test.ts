import { describe, expect, it } from "vitest";
import { currentMonthPeriod } from "@/lib/books/period";
import { addDays, isoDate, manilaToday } from "@/lib/format";
import { activitySummary, documentHref } from "@/lib/home/activity";
import { homeMonthBounds, homeOwedSplit, homeSumAmounts, homeTodayPlusDaysYmd } from "@/lib/home/dashboard";
import { hasOverdueOwed, owedByCustomersSplit, sumPesoAmounts } from "@/lib/home/money";
import { HOME_NON_VAT_TITLE, homeNonVatHelperLine } from "@/lib/home/nonVatCopy";
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
    expect(canShowMoneyFigure("billedThisMonth", staff, flagsOff)).toBe(true);
    expect(canShowMoneyFigure("supplierBillsDueSoon", costs, flagsOff)).toBe(false);
  });

  it("hides action rows when count is 0, and cost rows without canSeeCosts", () => {
    const staff = user({ costs: false });
    const costs = user({ costs: true });
    expect(canShowActionRow("billingsOverdue", 0, costs)).toBe(false);
    expect(canShowActionRow("billingsOverdue", 2, costs)).toBe(true);
    expect(canShowActionRow("billsOverPo", 3, staff)).toBe(false);
    expect(canShowActionRow("billsOverPo", 3, costs)).toBe(true);
    expect(canShowActionRow("quotesNeedsApproval", 1, staff)).toBe(true);
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

describe("home Non-VAT card copy", () => {
  it("uses the agreed title and settings-driven warn percents in the helper", () => {
    expect(HOME_NON_VAT_TITLE).toBe("Non-VAT sales limit (₱3M)");
    expect(homeNonVatHelperLine(70, 90)).toBe(
      "Estimate based on invoices in this app for this year. Your accountant's books are the official count. Warns at 70% and 90%.",
    );
    expect(homeNonVatHelperLine(50, 80)).toContain("Warns at 50% and 80%.");
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
});
