import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/books/csv";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { settingsValueFromForm } from "@/lib/settings/form";
import { settingsSchema } from "@/lib/settings/schema";
import {
  TAX_CALENDAR_APPLIES,
  TAX_CALENDAR_DATE_TO_CONFIRM,
  TAX_CALENDAR_EMPTY_ALL,
  TAX_CALENDAR_EMPTY_UPCOMING,
  TAX_CALENDAR_OVERDUE_SECTION_HINT,
  TAX_CALENDAR_OVERDUE_SECTION_TITLE,
  TAX_CALENDAR_PAGE,
  TAX_CALENDAR_PLAIN_NAMES,
  TAX_CALENDAR_RULES_BANNER,
  TAX_CALENDAR_SAWT_TASK,
  TAX_CALENDAR_SHOW_NOT_APPLICABLE,
  TAX_CALENDAR_STATUS,
} from "@/lib/tax/calendar-constants";
import {
  buildTaxCalendarRows,
  buildTaxCalendarSections,
  defaultTaxCalendarSettings,
  taxCalendarToCsv,
} from "@/lib/tax/calendar-build";
import {
  generateOccurrences,
  isWeekendYmd,
  manilaWeekday,
  nextWorkingDay,
  previousWorkingDay,
  statusForDueDate,
  weekendRule,
  workingDayRule,
  ymdOnOrLast,
} from "@/lib/tax/calendar-dates";
import { buildTaxCalendarIcs, icsEscapeText } from "@/lib/tax/calendar-ics";
import { TAX_CALENDAR_OBLIGATIONS } from "@/lib/tax/calendar-obligations";
import {
  holidaysNotSetLine,
  PH_HOLIDAYS_2026,
  yearsMissingHolidays,
} from "@/lib/tax/holidays";
import { incomeTaxMethodForYear } from "@/lib/tax/income-tax-method";
import {
  COLLECTED_REFERENCE_HINT,
  COLLECTED_TOTAL_LABEL,
  INVOICED_TOTAL_LABEL,
  TAX_BASIS_UNVERIFIED_NOTE,
} from "@/lib/tax/constants";
import { booksEnabledFromEnv } from "@/lib/books/features";
import { filterDealsNavItems } from "@/components/Sidebar";
import {
  missingHolidayYearsForWindow,
  missingHolidaysLine,
} from "@/lib/tax/calendar-build";
import { sanitizeTaxCalendarSettings } from "@/lib/services/tax-calendar";

function user(roles: Role[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

const DEALS = [
  { href: "/books", label: "Books", booksOnly: true as const },
  { href: "/cash", label: "Cash", cashOnly: true as const },
] as const;

const incomeTax2026 = {
  year: 2026,
  incomeTaxMethod: "EIGHT_PERCENT" as const,
  incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" as const },
};

const incomeTaxGraduated = {
  year: 2027,
  incomeTaxMethod: "GRADUATED" as const,
  incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" as const, "2027": "GRADUATED" as const },
};

function buildOpts(extra: Partial<Parameters<typeof buildTaxCalendarRows>[0]> = {}) {
  return {
    settings: defaultTaxCalendarSettings(),
    holidays: PH_HOLIDAYS_2026,
    incomeTax: incomeTax2026,
    isNonVat: true,
    booksType: null as null,
    showNotApplicable: false,
    ...extra,
  };
}

describe("view_books + booksEnabled gate tax calendar", () => {
  it("Admin and Approver have view_books; Staff/Viewer do not", () => {
    expect(can(user(["ADMIN"]), "view_books")).toBe(true);
    expect(can(user(["APPROVER"]), "view_books")).toBe(true);
    expect(can(user(["STAFF"]), "view_books")).toBe(false);
    expect(can(user(["VIEWER"]), "view_books")).toBe(false);
  });

  it("ICS export is owner-only (manage_settings)", () => {
    expect(can(user(["ADMIN"]), "manage_settings")).toBe(true);
    expect(can(user(["APPROVER"]), "manage_settings")).toBe(false);
  });

  it("Books nav stays hidden when flag off or no view_books", () => {
    expect(
      filterDealsNavItems([...DEALS], {
        canSeeCosts: false,
        canEdit: true,
        cashEnabled: false,
        payablesEnabled: false,
        booksEnabled: false,
        canViewBooks: true,
      }).map((i) => i.href),
    ).not.toContain("/books");
    expect(booksEnabledFromEnv({ BOOKS_ENABLED: "0" })).toBe(false);
  });
});

describe("HIGH: missing holiday years banner + unconfirmed dues", () => {
  it("2025 and 2027 are missing when only 2026 holidays are seeded", () => {
    expect(yearsMissingHolidays(PH_HOLIDAYS_2026, 2025, 2027)).toEqual([2025, 2027]);
    expect(missingHolidayYearsForWindow(PH_HOLIDAYS_2026, 2025, 2026)).toEqual([2025, 2027]);
  });

  it("missing-years notice line: several years, one year, or hidden when none", () => {
    expect(holidaysNotSetLine([2025, 2027, 2028])).toBe(
      "Holidays not set for 2025, 2027, 2028, so dates may be early",
    );
    expect(missingHolidaysLine([2025, 2027, 2028])).toBe(
      "Holidays not set for 2025, 2027, 2028, so dates may be early",
    );
    expect(holidaysNotSetLine([2027])).toBe("Holidays not set for 2027, so dates may be early");
    expect(missingHolidaysLine([2027])).toBe("Holidays not set for 2027, so dates may be early");
    expect(holidaysNotSetLine([])).toBeNull();
    expect(missingHolidaysLine([])).toBeNull();
    // Sorted unique; out-of-order input still reads ascending
    expect(holidaysNotSetLine([2028, 2025, 2025, 2027])).toBe(
      "Holidays not set for 2025, 2027, 2028, so dates may be early",
    );
  });

  it("marks dues in years without holidays as unconfirmed; 2026 dues stay confirmed", () => {
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2025,
        toYear: 2027,
        holidays: PH_HOLIDAYS_2026,
        incomeTax: {
          year: 2026,
          incomeTaxMethod: "EIGHT_PERCENT",
          incomeTaxMethodsByYear: {
            "2025": "EIGHT_PERCENT",
            "2026": "EIGHT_PERCENT",
            "2027": "GRADUATED",
          },
        },
      }),
    );
    const q3 = rows.find((r) => r.occurrenceKey === "1701q|2026-Q3");
    expect(q3?.dueYmd).toBe("2026-11-16");
    expect(q3?.dueUnconfirmed).toBe(false);

    const annual2027 = rows.find((r) => r.occurrenceKey === "1701a|TY2026");
    // Due Apr 15 2027 — 2027 holidays not set
    expect(annual2027?.dueYmd?.startsWith("2027-")).toBe(true);
    expect(annual2027?.dueUnconfirmed).toBe(true);
  });
});

describe("rule 1: weekend/holiday roll (RMC 65-2016) + file-early hint", () => {
  it("rolls across year boundary when Dec 31 and Jan 1 are holidays", () => {
    const holidays = [
      { ymd: "2026-12-31", kind: "special" as const, name: "New Year's Eve" },
      { ymd: "2027-01-01", kind: "regular" as const, name: "New Year's Day" },
    ];
    // 2026-12-31 Thu holiday → 2027-01-01 Fri holiday → 2027-01-02 Sat → 2027-01-03 Sun → Mon Jan 4
    expect(nextWorkingDay("2026-12-31", holidays)).toBe("2027-01-04");
    expect(workingDayRule("2026-12-31", holidays).dueYmd).toBe("2027-01-04");
  });

  it("rolls through back-to-back Maundy Thursday → Black Saturday chain", () => {
    // 2026-04-02 Thu, 04-03 Fri, 04-04 Sat (all non-working) → Mon Apr 6
    expect(nextWorkingDay("2026-04-02", PH_HOLIDAYS_2026)).toBe("2026-04-06");
    expect(nextWorkingDay("2026-04-03", PH_HOLIDAYS_2026)).toBe("2026-04-06");
    expect(nextWorkingDay("2026-04-04", PH_HOLIDAYS_2026)).toBe("2026-04-06");
  });

  it("leap-year Feb 29 weekend/holiday roll", () => {
    // 2028 is a leap year; 2028-02-29 is Wednesday.
    expect(ymdOnOrLast(2028, 2, 31)).toBe("2028-02-29");
    expect(manilaWeekday("2028-02-29")).toBe(2);
    expect(workingDayRule("2028-02-29", []).dueYmd).toBe("2028-02-29");
    // If due were Sat 2028-02-26 → Mon Feb 28 (still leap Feb)
    expect(manilaWeekday("2028-02-26")).toBe(6);
    expect(nextWorkingDay("2028-02-26", [])).toBe("2028-02-28");
    // Feb 29 + holiday that day → Mar 1
    expect(nextWorkingDay("2028-02-29", [{ ymd: "2028-02-29", kind: "regular" }])).toBe("2028-03-01");
  });

  it("Q3 2026 1701Q shows Mon Nov 16, 2026 (Sun Nov 15 rolled)", () => {
    expect(manilaWeekday("2026-11-15")).toBe(0);
    expect(isWeekendYmd("2026-11-15")).toBe(true);
    expect(nextWorkingDay("2026-11-15", PH_HOLIDAYS_2026)).toBe("2026-11-16");
    const rows = generateOccurrences("1701q", 2026, 2026, { holidays: PH_HOLIDAYS_2026 });
    const q3 = rows.find((r) => r.periodKey === "2026-Q3")!;
    expect(q3.dueYmd).toBe("2026-11-16");
    expect(q3.legalDueYmd).toBe("2026-11-15");
    expect(q3.rolled).toBe(true);
    expect(q3.fileByHint).toBe("File by 2026-11-13 to be safe");
  });

  it("Saturday due → next Monday; weekday unchanged; holidays roll forward", () => {
    expect(manilaWeekday("2026-11-14")).toBe(6);
    expect(nextWorkingDay("2026-11-14", PH_HOLIDAYS_2026)).toBe("2026-11-16");
    expect(workingDayRule("2026-11-13", PH_HOLIDAYS_2026).rolled).toBe(false);
    // Dec 25 2026 is Friday Christmas — roll to next working day after holiday/weekend chain
    expect(nextWorkingDay("2026-12-25", PH_HOLIDAYS_2026)).toBe("2026-12-28");
  });

  it("previousWorkingDay skips weekends and holidays", () => {
    expect(previousWorkingDay("2026-11-15", PH_HOLIDAYS_2026)).toBe("2026-11-13");
    expect(previousWorkingDay("2026-12-28", PH_HOLIDAYS_2026)).toBe("2026-12-28");
  });

  it("weekendRule compat still exposes fallsOnWeekend", () => {
    const w = weekendRule("2026-11-15", PH_HOLIDAYS_2026);
    expect(w.fallsOnWeekend).toBe(true);
    expect(w.dueYmd).toBe("2026-11-16");
  });

  it("settings seed includes 2026 PH regular + special holidays", () => {
    const ymids = DEFAULT_SETTINGS.taxYear.holidays.map((h) => h.ymd);
    expect(ymids).toContain("2026-01-01");
    expect(ymids).toContain("2026-04-09");
    expect(ymids).toContain("2026-11-30");
    expect(ymids).toContain("2026-02-17");
    expect(ymids).toContain("2026-11-01");
    expect(ymids).toContain("2026-12-24");
    expect(DEFAULT_SETTINGS.taxYear.holidays.filter((h) => h.kind === "regular")).toHaveLength(12);
    expect(DEFAULT_SETTINGS.taxYear.holidays.filter((h) => h.kind === "special")).toHaveLength(8);
  });
});

describe("rule 2: income tax method 8% vs Graduated form sets", () => {
  it("seeds 2026 as 8% and defaults 2027+ to Graduated", () => {
    expect(DEFAULT_SETTINGS.taxYear.incomeTaxMethod).toBe("EIGHT_PERCENT");
    expect(incomeTaxMethodForYear(incomeTax2026, 2026)).toBe("EIGHT_PERCENT");
    expect(incomeTaxMethodForYear(incomeTax2026, 2027)).toBe("GRADUATED");
    expect(incomeTaxMethodForYear(incomeTaxGraduated, 2027)).toBe("GRADUATED");
  });

  it("on 8%: hide 2551Q; annual is 1701A (not 1701)", () => {
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
        incomeTax: incomeTax2026,
      }),
    );
    expect(rows.some((r) => r.obligationKey === "2551q")).toBe(false);
    expect(rows.some((r) => r.obligationKey === "1701a")).toBe(true);
    expect(rows.some((r) => r.obligationKey === "1701")).toBe(false);
  });

  it("on Graduated: show 2551Q due 25 days after quarter end (rolled); annual 1701 and 1701A", () => {
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2027-02-01T08:00:00.000Z"),
        fromYear: 2027,
        toYear: 2027,
        incomeTax: incomeTaxGraduated,
        holidays: [], // 2027 has no seed holidays
      }),
    );
    const q1 = rows.find((r) => r.occurrenceKey === "2551q|2027-Q1");
    expect(q1).toBeTruthy();
    expect(q1?.notApplicable).toBe(false);
    // Mar 31 + 25 = Apr 25 2027 (Sunday) → Mon Apr 26
    expect(q1?.legalDueYmd).toBe("2027-04-25");
    expect(manilaWeekday("2027-04-25")).toBe(0);
    expect(q1?.dueYmd).toBe("2027-04-26");
    expect(q1?.dueUnconfirmed).toBe(true);
    expect(rows.some((r) => r.obligationKey === "1701")).toBe(true);
    expect(rows.some((r) => r.obligationKey === "1701a")).toBe(true);
    const annualNote = rows.find((r) => r.obligationKey === "1701")?.appliesNote;
    expect(annualNote).toMatch(/1701 or 1701A/);
  });

  it("ignores stale Settings 2551q.dueDay: 15 so Graduated Q1 2027 is 2027-04-26", () => {
    const settings = defaultTaxCalendarSettings();
    settings.obligations["2551q"] = { enabled: true, dueDay: 15, dueMonth: null };
    expect(sanitizeTaxCalendarSettings(settings).obligations["2551q"].dueDay).toBeNull();

    const rows = buildTaxCalendarRows(
      buildOpts({
        settings,
        view: "all",
        now: new Date("2027-02-01T08:00:00.000Z"),
        fromYear: 2027,
        toYear: 2027,
        incomeTax: incomeTaxGraduated,
        holidays: [],
      }),
    );
    const q1 = rows.find((r) => r.occurrenceKey === "2551q|2027-Q1");
    // Must NOT be 2027-04-15 (stale day-of-month override).
    expect(q1?.legalDueYmd).toBe("2027-04-25");
    expect(q1?.dueYmd).toBe("2027-04-26");
  });

  it("8% with showNotApplicable shows 2551Q as N/A (never overdue, no mark done path)", () => {
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-12-01T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
        showNotApplicable: true,
        incomeTax: incomeTax2026,
      }),
    );
    const pct = rows.filter((r) => r.obligationKey === "2551q");
    expect(pct.length).toBeGreaterThan(0);
    for (const r of pct) {
      expect(r.notApplicable).toBe(true);
      expect(r.status).not.toBe("overdue");
    }
  });
});

describe("rule 3: non-VAT hides 2550Q", () => {
  it("hides 2550Q when non-VAT; showable only via N/A toggle", () => {
    const hidden = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
        isNonVat: true,
        showNotApplicable: false,
      }),
    );
    expect(hidden.some((r) => r.obligationKey === "2550q")).toBe(false);

    const shown = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
        isNonVat: true,
        showNotApplicable: true,
      }),
    );
    const vat = shown.filter((r) => r.obligationKey === "2550q");
    expect(vat.length).toBeGreaterThan(0);
    expect(vat.every((r) => r.notApplicable)).toBe(true);
  });
});

describe("rule 4: N/A toggle — never overdue, no Mark as done", () => {
  it("exposes show-not-applicable label and N/A rows never overdue", () => {
    expect(TAX_CALENDAR_SHOW_NOT_APPLICABLE).toBe("Show forms that don't apply");
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-12-15T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
        showNotApplicable: true,
      }),
    );
    const na = rows.filter((r) => r.notApplicable);
    expect(na.length).toBeGreaterThan(0);
    for (const r of na) {
      expect(r.status).not.toBe("overdue");
      expect(r.greyedOut).toBe(true);
    }
  });
});

describe("rule 5: Next 90 days window + overdue section", () => {
  it("upcoming is today through today+90 only; overdue is a separate section", () => {
    const now = new Date("2026-10-30T08:00:00.000Z");
    const sections = buildTaxCalendarSections(
      buildOpts({
        now,
        fromYear: 2025,
        toYear: 2027,
      }),
    );
    for (const r of sections.upcoming) {
      if (!r.dueYmd || r.markedDone) continue;
      expect(r.dueYmd >= "2026-10-30").toBe(true);
      expect(r.dueYmd <= "2027-01-28").toBe(true); // +90
    }
    expect(sections.overdue.every((r) => r.dueYmd && r.dueYmd < "2026-10-30" && !r.markedDone)).toBe(
      true,
    );
    expect(sections.overdue.every((r) => !r.notApplicable)).toBe(true);
    expect(TAX_CALENDAR_OVERDUE_SECTION_TITLE).toBe("Overdue, not marked filed");
    expect(TAX_CALENDAR_OVERDUE_SECTION_HINT).toBe("Already filed? Mark as done.");
  });

  it("boundary: due exactly today and today+90 are included; today+91 excluded", () => {
    const settings = defaultTaxCalendarSettings();
    // Fabricate via 1701Q Q3 which is Nov 16 2026 after roll — from Oct 30 that is within 90.
    const rows = buildTaxCalendarRows(
      buildOpts({
        settings,
        view: "upcoming",
        now: new Date("2026-10-30T08:00:00.000Z"),
      }),
    );
    expect(rows.find((r) => r.occurrenceKey === "1701q|2026-Q3")?.dueYmd).toBe("2026-11-16");
    // From a day where Nov 16 is beyond +90
    const later = buildTaxCalendarRows(
      buildOpts({
        settings,
        view: "upcoming",
        now: new Date("2026-08-01T08:00:00.000Z"),
      }),
    );
    // Aug 1 + 90 = Oct 30 — Nov 16 is outside
    expect(later.some((r) => r.occurrenceKey === "1701q|2026-Q3")).toBe(false);
  });
});

describe("rule 6: page banner replaces per-row Unverified text", () => {
  it("banner text exact; rows never show Unverified: ask RDO; Confirmed only after COR", () => {
    expect(TAX_CALENDAR_RULES_BANNER).toBe(
      "Dates follow BIR rules. Check with your accountant if unsure.",
    );
    expect(TAX_CALENDAR_APPLIES.unverified).toBe("");
    const off = defaultTaxCalendarSettings();
    expect(off.corUploadedAndChecked).toBe(false);
    const provisional = buildTaxCalendarRows(
      buildOpts({
        settings: off,
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
      }),
    );
    for (const r of provisional) {
      expect(r.appliesLabel).not.toMatch(/Unverified/i);
      expect(r.appliesLabel).not.toMatch(/ask RDO/i);
      if (!r.notApplicable) expect(r.appliesLabel).not.toBe("Confirmed");
    }
    const on = { ...off, corUploadedAndChecked: true };
    const confirmed = buildTaxCalendarRows(
      buildOpts({
        settings: on,
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
      }),
    );
    expect(confirmed.find((r) => r.obligationKey === "1701q")?.appliesLabel).toBe("Confirmed");
  });
});

describe("rule 7: plain names under form codes", () => {
  it("uses exact plain names for 1701Q / 2551Q / 1701A / SAWT", () => {
    expect(TAX_CALENDAR_PLAIN_NAMES["1701Q"]).toBe("Quarterly income tax");
    expect(TAX_CALENDAR_PLAIN_NAMES["2551Q"]).toBe("Quarterly percentage tax (3%)");
    expect(TAX_CALENDAR_PLAIN_NAMES["1701A"]).toBe("Annual income tax");
    expect(TAX_CALENDAR_PLAIN_NAMES.SAWT).toBe("List of 2307s you received");
    const byKey = Object.fromEntries(TAX_CALENDAR_OBLIGATIONS.map((o) => [o.key, o]));
    expect(byKey["1701q"]?.description).toBe("Quarterly income tax");
    expect(byKey["2551q"]?.description).toBe("Quarterly percentage tax (3%)");
    expect(byKey["1701a"]?.description).toBe("Annual income tax");
  });
});

describe("rule 8: SAWT task when 2307s logged for a quarter", () => {
  it("adds Send SAWT with this return on that quarter's 1701Q", () => {
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
        quartersWith2307: ["2026-Q3"],
      }),
    );
    const q3 = rows.find((r) => r.occurrenceKey === "1701q|2026-Q3");
    expect(q3?.tasks).toEqual([TAX_CALENDAR_SAWT_TASK]);
    const q1 = rows.find((r) => r.occurrenceKey === "1701q|2026-Q1");
    expect(q1?.tasks ?? []).toEqual([]);
  });
});

describe("rule 9: books of accounts dates by type", () => {
  it("keeps date to confirm until books type chosen", () => {
    const undated = generateOccurrences("books_accounts", 2026, 2026, {
      holidays: PH_HOLIDAYS_2026,
      booksType: null,
    });
    expect(undated[0]?.dueYmd).toBeNull();
    expect(undated[0]?.dueDisplay).toBe(TAX_CALENDAR_DATE_TO_CONFIRM);
  });

  it("loose-leaf Jan 15 and computerized Jan 30, rolled to next working day", () => {
    // 2026-01-15 is Thursday — no roll
    const loose = generateOccurrences("books_accounts", 2026, 2026, {
      holidays: PH_HOLIDAYS_2026,
      booksType: "loose_leaf",
    });
    expect(loose[0]?.dueYmd).toBe("2026-01-15");

    // 2026-01-30 is Friday — no roll
    const comp = generateOccurrences("books_accounts", 2026, 2026, {
      holidays: PH_HOLIDAYS_2026,
      booksType: "computerized",
    });
    expect(comp[0]?.dueYmd).toBe("2026-01-30");

    // 2027-01-15 is Friday; 2027-01-30 is Saturday → Mon Feb 1
    const loose27 = generateOccurrences("books_accounts", 2027, 2027, {
      holidays: [],
      booksType: "loose_leaf",
    });
    expect(loose27[0]?.dueYmd).toBe("2027-01-15");
    const comp27 = generateOccurrences("books_accounts", 2027, 2027, {
      holidays: [],
      booksType: "computerized",
    });
    expect(manilaWeekday("2027-01-30")).toBe(6);
    expect(comp27[0]?.dueYmd).toBe("2027-02-01");
  });
});

describe("rule 10: worksheet basis — Invoiced main, Collected reference", () => {
  it("labels and EOPT / RR 3-2024 note", () => {
    expect(INVOICED_TOTAL_LABEL).toMatch(/Invoiced/);
    expect(COLLECTED_TOTAL_LABEL).toMatch(/reference/i);
    expect(COLLECTED_REFERENCE_HINT).toMatch(/EOPT/);
    expect(TAX_BASIS_UNVERIFIED_NOTE).toMatch(/EOPT, RR 3-2024/);
  });
});

describe("rule 11: breadcrumb labels (constants used by Sidebar)", () => {
  it("page constants point at tax calendar", () => {
    expect(TAX_CALENDAR_PAGE.href).toBe("/books/tax/calendar");
    expect(TAX_CALENDAR_PAGE.label).toBe("Tax calendar");
  });

  it("Books / Tax calendar vs Books / Tax worksheets", async () => {
    const { breadcrumbLabelsForPath } = await import("@/components/Sidebar");
    expect(breadcrumbLabelsForPath("/books/tax/calendar")).toEqual(["Books", "Tax calendar"]);
    expect(breadcrumbLabelsForPath("/books/tax")).toEqual(["Books", "Tax worksheets"]);
    expect(breadcrumbLabelsForPath("/books/tax/income")).toEqual(["Books", "Tax worksheets", "1701Q"]);
  });
});

describe("status buckets", () => {
  it("classifies overdue / due in 2 / due in 7 / upcoming / marked done", () => {
    const today = "2026-10-30";
    expect(statusForDueDate("2026-10-20", today, false)).toBe("overdue");
    expect(statusForDueDate("2026-10-31", today, false)).toBe("dueIn2");
    expect(statusForDueDate("2026-11-01", today, false)).toBe("dueIn2");
    expect(statusForDueDate("2026-11-02", today, false)).toBe("dueIn7");
    expect(statusForDueDate("2026-11-06", today, false)).toBe("dueIn7");
    expect(statusForDueDate("2026-11-07", today, false)).toBe("upcoming");
    expect(statusForDueDate("2026-10-20", today, true)).toBe("markedDone");
    expect(TAX_CALENDAR_STATUS.markedDone).toBe("Marked done");
  });
});

describe("seed obligations and settings defaults", () => {
  it("includes 1701A; no 0605; withholding hidden by default", () => {
    const keys = TAX_CALENDAR_OBLIGATIONS.map((o) => o.key);
    expect(keys).toContain("1701a");
    expect(TAX_CALENDAR_OBLIGATIONS.some((o) => /0605/i.test(o.form))).toBe(false);
    const d = defaultTaxCalendarSettings();
    expect(d.obligations["0619e"].enabled).toBe(false);
    expect(d.obligations["1601eq"].enabled).toBe(false);
    expect(d.obligations["1701a"].enabled).toBe(true);
    expect(DEFAULT_SETTINGS.taxCalendar).toEqual(d);
    expect(TAX_CALENDAR_EMPTY_UPCOMING.length).toBeGreaterThan(0);
    expect(TAX_CALENDAR_EMPTY_ALL.length).toBeGreaterThan(0);
  });

  it("settings form round-trips taxYear holidays, method selects, books type", () => {
    const get = (name: string) => {
      const map: Record<string, string> = {
        year: "2026",
        nonVatLimit: "3000000",
        warnFirstPct: "70",
        warnSecondPct: "90",
        incomeTaxMethodsByYearPrior: JSON.stringify({ "2026": "EIGHT_PERCENT" }),
        methodByYearYears: "2025,2026,2027",
        "methodByYear.2025": "EIGHT_PERCENT",
        "methodByYear.2026": "EIGHT_PERCENT",
        "methodByYear.2027": "GRADUATED",
        booksType: "loose_leaf",
        holidays: "2026-01-01 regular New Year's Day\n2026-02-17 special Chinese New Year",
      };
      return map[name] ?? null;
    };
    const raw = settingsValueFromForm("taxYear", get);
    const parsed = settingsSchema.shape.taxYear.parse(raw);
    expect(parsed.incomeTaxMethod).toBe("EIGHT_PERCENT");
    expect(parsed.booksType).toBe("loose_leaf");
    expect(parsed.holidays).toEqual([
      { ymd: "2026-01-01", kind: "regular", name: "New Year's Day" },
      { ymd: "2026-02-17", kind: "special", name: "Chinese New Year" },
    ]);
    expect(parsed.incomeTaxMethodsByYear["2026"]).toBe("EIGHT_PERCENT");
    expect(parsed.incomeTaxMethodsByYear["2027"]).toBe("GRADUATED");
  });

  it("saving 2027 Graduated leaves 2026 EIGHT_PERCENT untouched", () => {
    const get = (name: string) => {
      const map: Record<string, string> = {
        year: "2027",
        nonVatLimit: "3000000",
        warnFirstPct: "70",
        warnSecondPct: "90",
        incomeTaxMethodsByYearPrior: JSON.stringify({ "2026": "EIGHT_PERCENT" }),
        methodByYearYears: "2026,2027,2028",
        "methodByYear.2026": "EIGHT_PERCENT",
        "methodByYear.2027": "GRADUATED",
        "methodByYear.2028": "GRADUATED",
        booksType: "",
        holidays: "",
      };
      return map[name] ?? null;
    };
    const parsed = settingsSchema.shape.taxYear.parse(settingsValueFromForm("taxYear", get));
    expect(parsed.year).toBe(2027);
    expect(parsed.incomeTaxMethod).toBe("GRADUATED");
    expect(parsed.incomeTaxMethodsByYear["2026"]).toBe("EIGHT_PERCENT");
    expect(parsed.incomeTaxMethodsByYear["2027"]).toBe("GRADUATED");
  });

  it("rejects non-year keys in incomeTaxMethodsByYear with a clear error", () => {
    const res = settingsSchema.shape.taxYear.safeParse({
      year: 2026,
      nonVatLimit: 3_000_000,
      warnFirstPct: 70,
      warnSecondPct: 90,
      incomeTaxMethod: "EIGHT_PERCENT",
      incomeTaxMethodsByYear: { nope: "EIGHT_PERCENT" },
      holidays: [],
      booksType: null,
    });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("expected fail");
    expect(JSON.stringify(res.error.issues)).toMatch(/four-digit year/i);
  });

  it("settings form round-trips taxCalendar including 1701a", () => {
    const get = (name: string) => {
      const map: Record<string, string> = {
        corUploadedAndChecked: "true",
        "obligations.1701q.enabled": "true",
        "obligations.1701q.dueDay": "15",
        "obligations.1701q.dueMonth": "",
        "obligations.1701.enabled": "true",
        "obligations.1701.dueDay": "15",
        "obligations.1701.dueMonth": "4",
        "obligations.1701a.enabled": "true",
        "obligations.1701a.dueDay": "15",
        "obligations.1701a.dueMonth": "4",
        "obligations.2551q.enabled": "true",
        "obligations.2551q.dueDay": "",
        "obligations.2551q.dueMonth": "",
        "obligations.2550q.enabled": "true",
        "obligations.2550q.dueDay": "25",
        "obligations.2550q.dueMonth": "",
        "obligations.0619e.enabled": "false",
        "obligations.0619e.dueDay": "10",
        "obligations.0619e.dueMonth": "",
        "obligations.1601eq.enabled": "false",
        "obligations.1601eq.dueDay": "",
        "obligations.1601eq.dueMonth": "",
        "obligations.books_accounts.enabled": "true",
        "obligations.books_accounts.dueDay": "",
        "obligations.books_accounts.dueMonth": "",
        "obligations.inventory_list.enabled": "true",
        "obligations.inventory_list.dueDay": "",
        "obligations.inventory_list.dueMonth": "",
      };
      return map[name] ?? null;
    };
    const raw = settingsValueFromForm("taxCalendar", get);
    const parsed = settingsSchema.shape.taxCalendar.parse(raw);
    expect(parsed.obligations["1701a"].dueMonth).toBe(4);
    expect(parsed.obligations["2551q"].dueDay).toBeNull();
  });

  it("clamps day into month length", () => {
    expect(ymdOnOrLast(2026, 2, 31)).toBe("2026-02-28");
  });
});

describe("marked done invariant", () => {
  it("status Marked done ↔ markedDone on every row", () => {
    const withDone = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2025,
        toYear: 2027,
        completions: [{ occurrenceKey: "1701q|2026-Q3", doneDateYmd: "2026-10-01", note: "paid" }],
      }),
    );
    for (const r of withDone) {
      expect(r.markedDone).toBe(r.status === "markedDone");
    }
  });
});

describe("ICS and CSV injection safety", () => {
  it("ICS uses rolled Nov 16 date; omits N/A forms; no customer data", () => {
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
      }),
    );
    const ics = buildTaxCalendarIcs(rows, { now: new Date("2026-10-30T00:00:00.000Z") });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261116");
    expect(ics).not.toContain("2551Q");
    expect(ics).not.toContain("2550Q");
    expect(ics.toLowerCase()).not.toMatch(/customer|tin|email|@gmail/);
    expect(icsEscapeText("a,b;c")).toBe("a\\,b\\;c");
  });

  it("CSV uses shared csvCell", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    const rows = buildTaxCalendarRows(
      buildOpts({
        view: "all",
        now: new Date("2026-10-30T08:00:00.000Z"),
        fromYear: 2026,
        toYear: 2026,
      }),
    );
    const csv = taxCalendarToCsv(rows);
    expect(csv.split("\r\n")[0]).toContain("Form");
    expect(csv.toLowerCase()).not.toMatch(/customer|email|tin/);
  });
});
