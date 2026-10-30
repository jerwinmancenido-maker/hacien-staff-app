import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/books/registers";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { settingsValueFromForm } from "@/lib/settings/form";
import { settingsSchema } from "@/lib/settings/schema";
import {
  TAX_CALENDAR_APPLIES,
  TAX_CALENDAR_DATE_TO_CONFIRM,
  TAX_CALENDAR_EMPTY_ALL,
  TAX_CALENDAR_EMPTY_UPCOMING,
  TAX_CALENDAR_PAGE,
  TAX_CALENDAR_PROVISIONAL_BANNER,
  TAX_CALENDAR_STATUS,
} from "@/lib/tax/calendar-constants";
import {
  buildTaxCalendarRows,
  defaultTaxCalendarSettings,
  taxCalendarToCsv,
} from "@/lib/tax/calendar-build";
import {
  generateOccurrences,
  isWeekendYmd,
  manilaWeekday,
  previousWorkingDay,
  statusForDueDate,
  weekendRule,
  ymdOnOrLast,
} from "@/lib/tax/calendar-dates";
import { buildTaxCalendarIcs, icsEscapeText } from "@/lib/tax/calendar-ics";
import { TAX_CALENDAR_OBLIGATIONS } from "@/lib/tax/calendar-obligations";
import { booksEnabledFromEnv } from "@/lib/books/features";
import { filterDealsNavItems } from "@/components/Sidebar";

function user(roles: Role[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

const DEALS = [
  { href: "/books", label: "Books", booksOnly: true as const },
  { href: "/cash", label: "Cash", cashOnly: true as const },
] as const;

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
    expect(
      filterDealsNavItems([...DEALS], {
        canSeeCosts: false,
        canEdit: true,
        cashEnabled: false,
        payablesEnabled: false,
        booksEnabled: true,
        canViewBooks: false,
      }).map((i) => i.href),
    ).not.toContain("/books");
    expect(booksEnabledFromEnv({ BOOKS_ENABLED: "0" })).toBe(false);
  });
});

describe("due-date and weekend logic (PHT)", () => {
  it("Nov 15, 2026 falls on Sunday; legal date stays; File by Fri Nov 13", () => {
    expect(manilaWeekday("2026-11-15")).toBe(0);
    expect(isWeekendYmd("2026-11-15")).toBe(true);
    expect(previousWorkingDay("2026-11-15")).toBe("2026-11-13");
    const w = weekendRule("2026-11-15");
    expect(w.legalDueYmd).toBe("2026-11-15");
    expect(w.fallsOnWeekend).toBe(true);
    expect(w.fileByYmd).toBe("2026-11-13");
    expect(w.fileByHint).toBe("File by 2026-11-13 to be safe");
  });

  it("Saturday due → previous Friday; weekday unchanged", () => {
    // 2026-11-14 is Saturday
    expect(manilaWeekday("2026-11-14")).toBe(6);
    expect(previousWorkingDay("2026-11-14")).toBe("2026-11-13");
    expect(weekendRule("2026-11-13").fallsOnWeekend).toBe(false);
    expect(weekendRule("2026-11-13").fileByHint).toBeNull();
  });

  it("1701Q seed dates: Q1 May 15, Q2 Aug 15, Q3 Nov 15", () => {
    const rows = generateOccurrences("1701q", 2026, 2026);
    expect(rows.map((r) => [r.periodKey, r.dueYmd])).toEqual([
      ["2026-Q1", "2026-05-15"],
      ["2026-Q2", "2026-08-15"],
      ["2026-Q3", "2026-11-15"],
    ]);
    const nov = rows.find((r) => r.periodKey === "2026-Q3")!;
    expect(nov.fileByHint).toBe("File by 2026-11-13 to be safe");
  });

  it("1701 annual is Apr 15 of the next year", () => {
    const rows = generateOccurrences("1701", 2026, 2027);
    const ty2026 = rows.find((r) => r.periodKey === "TY2026");
    expect(ty2026?.dueYmd).toBe("2027-04-15");
  });

  it("0619-E monthly on the 10th; 1601-EQ last day of month after quarter", () => {
    const m = generateOccurrences("0619e", 2026, 2026);
    expect(m.find((r) => r.periodKey === "2026-03")?.dueYmd).toBe("2026-03-10");
    const q = generateOccurrences("1601eq", 2026, 2026);
    // Q1 ends Mar → due last day of April
    expect(q.find((r) => r.periodKey === "2026-Q1")?.dueYmd).toBe("2026-04-30");
    expect(q.find((r) => r.periodKey === "2026-Q4")?.dueYmd).toBe("2027-01-31");
  });

  it("undated year-end shows date to confirm", () => {
    const rows = generateOccurrences("books_accounts", 2026, 2026);
    expect(rows[0]?.dueYmd).toBeNull();
    expect(rows[0]?.dueDisplay).toBe(TAX_CALENDAR_DATE_TO_CONFIRM);
  });

  it("clamps day into month length", () => {
    expect(ymdOnOrLast(2026, 2, 31)).toBe("2026-02-28");
    expect(ymdOnOrLast(2028, 2, 31)).toBe("2028-02-29");
  });
});

describe("status buckets", () => {
  it("classifies overdue / due in 2 / due in 7 / upcoming / marked done", () => {
    const today = "2026-10-30";
    expect(statusForDueDate("2026-10-20", today, false)).toBe("overdue");
    expect(statusForDueDate("2026-10-31", today, false)).toBe("dueIn2"); // +1
    expect(statusForDueDate("2026-11-01", today, false)).toBe("dueIn2"); // +2
    expect(statusForDueDate("2026-11-02", today, false)).toBe("dueIn7"); // +3
    expect(statusForDueDate("2026-11-06", today, false)).toBe("dueIn7"); // +7
    expect(statusForDueDate("2026-11-07", today, false)).toBe("upcoming"); // +8
    expect(statusForDueDate("2026-11-08", today, false)).toBe("upcoming");
    expect(statusForDueDate("2026-10-20", today, true)).toBe("markedDone");
    expect(statusForDueDate(null, today, false)).toBe("upcoming");
    expect(TAX_CALENDAR_STATUS.dueIn2).toBe("Due in 2 days");
    expect(TAX_CALENDAR_STATUS.dueIn7).toBe("Due in 7 days");
    expect(TAX_CALENDAR_STATUS.markedDone).toBe("Marked done");
  });
});

describe("seed obligations and settings defaults", () => {
  it("tags each seed UNVERIFIED / applies correctly; hides withholding by default; no 0605", () => {
    const byKey = Object.fromEntries(TAX_CALENDAR_OBLIGATIONS.map((o) => [o.key, o]));
    expect(byKey["1701q"]?.applies).toBe("confirmed");
    expect(byKey["1701q"]?.worksheetHref).toBe("/books/tax/income");
    expect(byKey["1701"]?.applies).toBe("confirmed");
    expect(byKey["2551q"]?.applies).toBe("does_not_apply");
    expect(byKey["2551q"]?.greyedOut).toBe(true);
    expect(byKey["2551q"]?.appliesNote).toMatch(/confirm 8% election with RDO/);
    expect(byKey["2550q"]?.applies).toBe("does_not_apply");
    expect(byKey["2550q"]?.appliesNote).toMatch(/COR may still show VAT/);
    expect(byKey["0619e"]?.defaultEnabled).toBe(false);
    expect(byKey["1601eq"]?.defaultEnabled).toBe(false);
    expect(byKey["0619e"]?.applies).toBe("unverified");
    expect(byKey["books_accounts"]?.applies).toBe("unverified");
    expect(byKey["inventory_list"]?.applies).toBe("unverified");
    expect(TAX_CALENDAR_OBLIGATIONS.some((o) => /0605/i.test(o.form))).toBe(false);
    for (const o of TAX_CALENDAR_OBLIGATIONS) {
      expect(o.sourceNote.length).toBeGreaterThan(0);
    }
    expect(TAX_CALENDAR_APPLIES.unverified).toBe("Unverified: ask RDO");
  });

  it("defaults hide 0619-E / 1601-EQ; COR toggle off; provisional banner text exact", () => {
    const d = defaultTaxCalendarSettings();
    expect(d.corUploadedAndChecked).toBe(false);
    expect(d.obligations["0619e"].enabled).toBe(false);
    expect(d.obligations["1601eq"].enabled).toBe(false);
    expect(d.obligations["1701q"].enabled).toBe(true);
    expect(DEFAULT_SETTINGS.taxCalendar).toEqual(d);
    expect(TAX_CALENDAR_PROVISIONAL_BANNER).toBe(
      "Provisional: built from documents on hand, not the BIR COR. Check with your accountant or RDO before relying on these dates.",
    );
    expect(TAX_CALENDAR_PAGE.href).toBe("/books/tax/calendar");
    expect(TAX_CALENDAR_EMPTY_UPCOMING.length).toBeGreaterThan(0);
    expect(TAX_CALENDAR_EMPTY_ALL.length).toBeGreaterThan(0);
  });

  it("settings form round-trips taxCalendar section", () => {
    const get = (name: string) => {
      const map: Record<string, string> = {
        corUploadedAndChecked: "true",
        "obligations.1701q.enabled": "true",
        "obligations.1701q.dueDay": "15",
        "obligations.1701q.dueMonth": "",
        "obligations.1701.enabled": "true",
        "obligations.1701.dueDay": "15",
        "obligations.1701.dueMonth": "4",
        "obligations.2551q.enabled": "true",
        "obligations.2551q.dueDay": "15",
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
    expect(parsed.corUploadedAndChecked).toBe(true);
    expect(parsed.obligations["0619e"].enabled).toBe(false);
    expect(parsed.obligations["1601eq"].dueDay).toBeNull();
    expect(parsed.obligations["1701"].dueMonth).toBe(4);
  });
});

describe("calendar build views", () => {
  it("upcoming 90 days includes Nov 15 2026 weekend hint from Oct 30; hides disabled withholding", () => {
    const settings = defaultTaxCalendarSettings();
    const rows = buildTaxCalendarRows({
      settings,
      view: "upcoming",
      now: new Date("2026-10-30T08:00:00.000Z"),
    });
    const q3 = rows.find((r) => r.occurrenceKey === "1701q|2026-Q3");
    expect(q3).toBeTruthy();
    expect(q3?.fileByHint).toBe("File by 2026-11-13 to be safe");
    expect(q3?.worksheetLink).toContain("/books/tax/income");
    expect(rows.some((r) => r.obligationKey === "0619e")).toBe(false);
    expect(rows.some((r) => r.obligationKey === "2551q" && r.greyedOut)).toBe(true);
  });

  it("marked done overrides status", () => {
    const settings = defaultTaxCalendarSettings();
    const rows = buildTaxCalendarRows({
      settings,
      view: "all",
      now: new Date("2026-10-30T08:00:00.000Z"),
      fromYear: 2026,
      toYear: 2026,
      completions: [{ occurrenceKey: "1701q|2026-Q3", doneDateYmd: "2026-10-01", note: "paid at bank" }],
    });
    const q3 = rows.find((r) => r.occurrenceKey === "1701q|2026-Q3");
    expect(q3?.status).toBe("markedDone");
    expect(q3?.statusLabel).toBe("Marked done");
    expect(q3?.doneNote).toBe("paid at bank");
  });
});

describe("ICS and CSV injection safety (no customer data)", () => {
  it("escapes RFC 5545 TEXT (backslash, comma, semicolon, newline)", () => {
    expect(icsEscapeText("a\\b")).toBe("a\\\\b");
    expect(icsEscapeText("a,b;c")).toBe("a\\,b\\;c");
    expect(icsEscapeText("line1\nline2")).toBe("line1\\nline2");
    expect(icsEscapeText("line1\r\nline2")).toBe("line1\\nline2");
  });

  it("ICS has 7-day and 2-day alarms, no customer-like fields", () => {
    const settings = defaultTaxCalendarSettings();
    const rows = buildTaxCalendarRows({
      settings,
      view: "all",
      now: new Date("2026-10-30T08:00:00.000Z"),
      fromYear: 2026,
      toYear: 2026,
    });
    const ics = buildTaxCalendarIcs(rows, { now: new Date("2026-10-30T00:00:00.000Z") });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("TRIGGER:-P7D");
    expect(ics).toContain("TRIGGER:-P2D");
    expect(ics).toContain("1701Q");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261115");
    // Greyed does-not-apply rows are omitted from ICS
    expect(ics).not.toContain("2551Q");
    expect(ics).not.toContain("2550Q");
    // No customer / PII-ish keys
    expect(ics.toLowerCase()).not.toMatch(/customer|tin|email|@gmail|phone|address:/);
    // Injection payload in description path via escape
    expect(icsEscapeText("=1+1")).toBe("=1+1");
    expect(icsEscapeText("SUM(A1);cmd")).toBe("SUM(A1)\\;cmd");
  });

  it("CSV uses shared csvCell (formula injection) and has no customer columns", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+cmd")).toBe("'+cmd");
    const settings = defaultTaxCalendarSettings();
    const rows = buildTaxCalendarRows({
      settings,
      view: "all",
      now: new Date("2026-10-30T08:00:00.000Z"),
      fromYear: 2026,
      toYear: 2026,
    });
    const poisoned = rows.map((r, i) =>
      i === 0 ? { ...r, description: "=cmd|'/C calc", form: "@SUM(A1)" } : r,
    );
    const csv = taxCalendarToCsv(poisoned);
    expect(csv.split("\r\n")[0]).toContain("Form");
    expect(csv).toContain("'=cmd|'/C calc");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv.toLowerCase()).not.toMatch(/customer|email|tin/);
  });
});
