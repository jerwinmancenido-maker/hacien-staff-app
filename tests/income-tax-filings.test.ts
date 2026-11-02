// Tests for 1701Q / 1701A Income tax filings card (pure logic, no DB).
// Fake data only — no customer PII.

import { describe, expect, it } from "vitest";
import {
  generateOccurrences,
  manilaTodayYmd,
  statusForDueDate,
  workingDayRule,
} from "@/lib/tax/calendar-dates";
import {
  buildTaxCalendarRows,
  defaultTaxCalendarSettings,
} from "@/lib/tax/calendar-build";
import { PH_HOLIDAYS_2026 } from "@/lib/tax/holidays";
import {
  defaultDoneDateYmd,
  isIncomeTaxFiled,
  selectNextFiling,
  selectNextIncomeTaxFilings,
  markTaxCalendarFiled,
  undoTaxCalendarFiled,
} from "@/lib/services/tax-calendar";
import { ForbiddenError, type PermissionUser } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { isoDate, manilaToday } from "@/lib/format";

const adminUser: PermissionUser & { id: string } = {
  id: "usr_admin_test",
  isAdmin: true,
  isApprover: true,
  isStaff: false,
  isViewer: false,
  active: true,
  canSeeCosts: true,
};

const approverUser: PermissionUser & { id: string } = {
  id: "usr_approver_test",
  isAdmin: false,
  isApprover: true,
  isStaff: false,
  isViewer: false,
  active: true,
  canSeeCosts: false,
};

const staffUser: PermissionUser & { id: string } = {
  id: "usr_staff_test",
  isAdmin: false,
  isApprover: false,
  isStaff: true,
  isViewer: false,
  active: true,
  canSeeCosts: false,
};

describe("1701Q / 1701A due-date calculations and rolls", () => {
  it("calculates 1701Q quarterly due dates (Q1: May 15, Q2: Aug 15, Q3: Nov 15) rolled for weekends/holidays", () => {
    const occs = generateOccurrences("1701q", 2026, 2026, {
      holidays: PH_HOLIDAYS_2026,
    });
    expect(occs).toHaveLength(3);

    const q1 = occs.find((o) => o.periodKey === "2026-Q1");
    const q2 = occs.find((o) => o.periodKey === "2026-Q2");
    const q3 = occs.find((o) => o.periodKey === "2026-Q3");

    expect(q1).toBeDefined();
    expect(q2).toBeDefined();
    expect(q3).toBeDefined();

    // 2026-05-15 is Friday (no roll)
    expect(q1?.legalDueYmd).toBe("2026-05-15");
    expect(q1?.dueYmd).toBe("2026-05-15");
    expect(q1?.rolled).toBe(false);

    // 2026-08-15 is Saturday -> rolls to Monday 2026-08-17
    expect(q2?.legalDueYmd).toBe("2026-08-15");
    expect(q2?.dueYmd).toBe("2026-08-17");
    expect(q2?.rolled).toBe(true);
    expect(q2?.fallsOnWeekend).toBe(true);

    // 2026-11-15 is Sunday -> rolls to Monday 2026-11-16
    expect(q3?.legalDueYmd).toBe("2026-11-15");
    expect(q3?.dueYmd).toBe("2026-11-16");
    expect(q3?.rolled).toBe(true);
    expect(q3?.fallsOnWeekend).toBe(true);
  });

  it("calculates 1701A annual due dates (due Apr 15 of next year) rolled for weekend/holiday", () => {
    // 2028-04-15 is Saturday -> rolls to Monday 2028-04-17
    const rule2028 = workingDayRule("2028-04-15", []);
    expect(rule2028.legalDueYmd).toBe("2028-04-15");
    expect(rule2028.dueYmd).toBe("2028-04-17");
    expect(rule2028.rolled).toBe(true);

    // 2026-04-15 is Wednesday (no roll)
    const occs = generateOccurrences("1701a", 2025, 2025, {
      holidays: PH_HOLIDAYS_2026,
    });
    const ty2025 = occs.find((o) => o.periodKey === "TY2025");
    expect(ty2025).toBeDefined();
    expect(ty2025?.legalDueYmd).toBe("2026-04-15");
    expect(ty2025?.dueYmd).toBe("2026-04-15");
  });
});

describe("next-filing selection logic", () => {
  const baseRows = buildTaxCalendarRows({
    settings: defaultTaxCalendarSettings(),
    holidays: PH_HOLIDAYS_2026,
    now: new Date("2026-09-01T08:00:00.000Z"),
    fromYear: 2026,
    toYear: 2026,
    incomeTax: {
      year: 2026,
      incomeTaxMethod: "EIGHT_PERCENT",
      incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" },
    },
    view: "all",
  });

  it("prioritizes an unfiled overdue occurrence over an upcoming cycle", () => {
    // When Q1 and Q2 are unfiled, earliest unfiled overdue is Q1.
    const selectedQ1 = selectNextFiling(baseRows, "1701q", "2026-09-01");
    expect(selectedQ1).toBeDefined();
    expect(selectedQ1?.occurrenceKey).toBe("1701q|2026-Q1");
    expect(selectedQ1?.markedDone).toBe(false);

    // Staff note without referenceNo is NOT a filing — Q1 stays the next item.
    const rowsWithQ1NoteOnly = baseRows.map((r) =>
      r.occurrenceKey === "1701q|2026-Q1"
        ? { ...r, markedDone: true, doneDateYmd: "2026-05-15", referenceNo: null }
        : r,
    );
    expect(isIncomeTaxFiled(rowsWithQ1NoteOnly.find((r) => r.occurrenceKey === "1701q|2026-Q1")!)).toBe(
      false,
    );
    expect(selectNextFiling(rowsWithQ1NoteOnly, "1701q", "2026-09-01")?.occurrenceKey).toBe(
      "1701q|2026-Q1",
    );

    // If Q1 is filed (ref present), then Q2 is the earliest overdue unfiled.
    const rowsWithQ1Done = baseRows.map((r) =>
      r.occurrenceKey === "1701q|2026-Q1"
        ? {
            ...r,
            markedDone: true,
            doneDateYmd: "2026-05-15",
            referenceNo: "TEST-REF-Q1",
          }
        : r,
    );
    const selectedQ2 = selectNextFiling(rowsWithQ1Done, "1701q", "2026-09-01");
    expect(selectedQ2).toBeDefined();
    expect(selectedQ2?.occurrenceKey).toBe("1701q|2026-Q2");
    expect(selectedQ2?.markedDone).toBe(false);
  });

  it("selects the upcoming cycle when earlier cycles are marked filed", () => {
    const rowsWithQ2Done = buildTaxCalendarRows({
      settings: defaultTaxCalendarSettings(),
      holidays: PH_HOLIDAYS_2026,
      now: new Date("2026-09-01T08:00:00.000Z"),
      fromYear: 2026,
      toYear: 2026,
      completions: [
        {
          occurrenceKey: "1701q|2026-Q1",
          doneDateYmd: "2026-05-10",
          note: "Filed early",
          referenceNo: "TEST-REF-001",
        },
        {
          occurrenceKey: "1701q|2026-Q2",
          doneDateYmd: "2026-08-14",
          note: null,
          referenceNo: "TEST-REF-002",
        },
      ],
      incomeTax: {
        year: 2026,
        incomeTaxMethod: "EIGHT_PERCENT",
        incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" },
      },
      view: "all",
    });

    // When Q2 is filed, next filing is Q3 (due 2026-11-16)
    const selected = selectNextFiling(rowsWithQ2Done, "1701q", "2026-09-01");
    expect(selected).toBeDefined();
    expect(selected?.occurrenceKey).toBe("1701q|2026-Q3");
    expect(selected?.markedDone).toBe(false);
  });

  it("reflects filed state with date and reference number", () => {
    const rowsWithQ3Done = buildTaxCalendarRows({
      settings: defaultTaxCalendarSettings(),
      holidays: PH_HOLIDAYS_2026,
      now: new Date("2026-11-03T08:00:00.000Z"),
      fromYear: 2026,
      toYear: 2026,
      completions: [
        {
          occurrenceKey: "1701q|2026-Q1",
          doneDateYmd: "2026-05-10",
          note: null,
          referenceNo: "TEST-REF-001",
        },
        {
          occurrenceKey: "1701q|2026-Q2",
          doneDateYmd: "2026-08-14",
          note: null,
          referenceNo: "TEST-REF-002",
        },
        {
          occurrenceKey: "1701q|2026-Q3",
          doneDateYmd: "2026-11-03",
          note: "eFPS filing confirmation",
          referenceNo: "TEST-REF-003",
        },
      ],
      incomeTax: {
        year: 2026,
        incomeTaxMethod: "EIGHT_PERCENT",
        incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" },
      },
      view: "all",
    });

    const { q1701, a1701 } = selectNextIncomeTaxFilings(rowsWithQ3Done, "2026-11-03");
    expect(q1701).toBeDefined();
    expect(q1701?.occurrenceKey).toBe("1701q|2026-Q3");
    expect(q1701?.markedDone).toBe(true);
    expect(q1701?.doneDateYmd).toBe("2026-11-03");
    expect(q1701?.referenceNo).toBe("TEST-REF-003");

    // a1701 is 1701A
    expect(a1701).toBeDefined();
    expect(a1701?.obligationKey).toBe("1701a");
    expect(a1701?.periodKey).toBe("TY2025");
  });
});

describe("Manila vs UTC midnight crossings (HIGH RISK tax dates)", () => {
  // Asia/Manila = UTC+8. 17:00Z is 01:00 the next calendar day in Manila.
  // Naive UTC `toISOString().slice(0,10)` is the wrong day for filed defaults and status.

  it("default filed date is the Manila calendar day when UTC is still the previous day", () => {
    // 2026-11-14 17:00 UTC = 2026-11-15 01:00 Asia/Manila
    const now = new Date("2026-11-14T17:00:00.000Z");
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-14"); // UTC-only trap
    expect(isoDate(manilaToday(now))).toBe("2026-11-15");
    expect(manilaTodayYmd(now)).toBe("2026-11-15");
    // Same helper the Home mark-filed default and tax calendar "done" default use.
    expect(defaultDoneDateYmd(now)).toBe("2026-11-15");
  });

  it("1701Q Q3 2026 legal Nov 15 rolls to Nov 16; status follows Manila day vs rolled due", () => {
    const occs = generateOccurrences("1701q", 2026, 2026, { holidays: PH_HOLIDAYS_2026 });
    const q3 = occs.find((o) => o.periodKey === "2026-Q3");
    expect(q3?.legalDueYmd).toBe("2026-11-15");
    // Sunday → next working day Monday
    expect(q3?.dueYmd).toBe("2026-11-16");
    const dueYmd = q3!.dueYmd!;

    // Day before legal Nov 15 in Manila (Nov 14 01:00 PHT); UTC still Nov 13.
    const dayBeforeLegal = new Date("2026-11-13T17:00:00.000Z");
    expect(dayBeforeLegal.toISOString().slice(0, 10)).toBe("2026-11-13");
    expect(manilaTodayYmd(dayBeforeLegal)).toBe("2026-11-14");
    expect(statusForDueDate(dueYmd, manilaTodayYmd(dayBeforeLegal), false)).not.toBe("overdue");

    // On legal Nov 15 in Manila (01:00 PHT); UTC still Nov 14 — not overdue yet (due is Nov 16).
    const onLegalDay = new Date("2026-11-14T17:00:00.000Z");
    expect(onLegalDay.toISOString().slice(0, 10)).toBe("2026-11-14");
    expect(manilaTodayYmd(onLegalDay)).toBe("2026-11-15");
    expect(statusForDueDate(dueYmd, manilaTodayYmd(onLegalDay), false)).toBe("dueIn2");
    expect(statusForDueDate(dueYmd, manilaTodayYmd(onLegalDay), false)).not.toBe("overdue");

    // Day after legal Nov 15 = rolled due day Nov 16 in Manila; UTC still Nov 15 — due today, not overdue.
    const onRolledDue = new Date("2026-11-15T17:00:00.000Z");
    expect(onRolledDue.toISOString().slice(0, 10)).toBe("2026-11-15");
    expect(manilaTodayYmd(onRolledDue)).toBe("2026-11-16");
    expect(statusForDueDate(dueYmd, manilaTodayYmd(onRolledDue), false)).toBe("dueIn2");
    expect(statusForDueDate(dueYmd, manilaTodayYmd(onRolledDue), false)).not.toBe("overdue");

    // Day after rolled due in Manila (Nov 17 01:00 PHT); UTC still Nov 16 — overdue.
    const dayAfterRolled = new Date("2026-11-16T17:00:00.000Z");
    expect(dayAfterRolled.toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(manilaTodayYmd(dayAfterRolled)).toBe("2026-11-17");
    expect(statusForDueDate(dueYmd, manilaTodayYmd(dayAfterRolled), false)).toBe("overdue");
  });

  it("buildTaxCalendarRows uses Manila today for 1701Q Q3 overdue across the UTC/Manila midnight split", () => {
    const incomeTax = {
      year: 2026,
      incomeTaxMethod: "EIGHT_PERCENT" as const,
      incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" as const },
    };
    const base = {
      settings: defaultTaxCalendarSettings(),
      holidays: PH_HOLIDAYS_2026,
      fromYear: 2026,
      toYear: 2026,
      incomeTax,
      view: "all" as const,
    };

    const q3At = (now: Date) =>
      buildTaxCalendarRows({ ...base, now }).find((r) => r.occurrenceKey === "1701q|2026-Q3");

    // Manila Nov 15 (UTC Nov 14 17:00) — rolled due Nov 16 is still in the future.
    const beforeDue = q3At(new Date("2026-11-14T17:00:00.000Z"));
    expect(beforeDue?.dueYmd).toBe("2026-11-16");
    expect(beforeDue?.status).toBe("dueIn2");
    expect(beforeDue?.status).not.toBe("overdue");

    // Manila Nov 16 (UTC Nov 15 17:00) — due today (Manila), not overdue.
    const onDue = q3At(new Date("2026-11-15T17:00:00.000Z"));
    expect(onDue?.status).toBe("dueIn2");
    expect(onDue?.status).not.toBe("overdue");

    // Manila Nov 17 (UTC Nov 16 17:00) — overdue.
    const afterDue = q3At(new Date("2026-11-16T17:00:00.000Z"));
    expect(afterDue?.status).toBe("overdue");
  });
});

describe("2551Q default on 8% and calendar visibility", () => {
  it("2551Q is OFF by default in DEFAULT_SETTINGS when 8% is on", () => {
    expect(DEFAULT_SETTINGS.taxYear.incomeTaxMethod).toBe("EIGHT_PERCENT");
    expect(DEFAULT_SETTINGS.taxCalendar.obligations["2551q"].enabled).toBe(false);
  });

  it("2551Q is hidden from the calendar when 8% option is on", () => {
    const rows = buildTaxCalendarRows({
      settings: defaultTaxCalendarSettings(),
      holidays: PH_HOLIDAYS_2026,
      now: new Date("2026-10-30T08:00:00.000Z"),
      fromYear: 2026,
      toYear: 2026,
      incomeTax: {
        year: 2026,
        incomeTaxMethod: "EIGHT_PERCENT",
        incomeTaxMethodsByYear: { "2026": "EIGHT_PERCENT" },
      },
      showNotApplicable: false,
      view: "all",
    });

    expect(rows.some((r) => r.obligationKey === "2551q")).toBe(false);
  });
});

describe("Admin-only permissions for marking and undoing filings", () => {
  it("rejects non-admin (Staff) from marking filed", async () => {
    await expect(
      markTaxCalendarFiled(
        {
          occurrenceKey: "1701q|2026-Q3",
          filedDateYmd: "2026-11-03",
          referenceNo: "TEST-REF-001",
          file: { name: "confirm.pdf", size: 10, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
        },
        staffUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects non-admin (Approver) from marking filed", async () => {
    await expect(
      markTaxCalendarFiled(
        {
          occurrenceKey: "1701q|2026-Q3",
          filedDateYmd: "2026-11-03",
          referenceNo: "TEST-REF-001",
          file: { name: "confirm.pdf", size: 10, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
        },
        approverUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects non-admin from undoing filed", async () => {
    await expect(
      undoTaxCalendarFiled(
        { occurrenceKey: "1701q|2026-Q3", reason: "testing" },
        staffUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      undoTaxCalendarFiled(
        { occurrenceKey: "1701q|2026-Q3", reason: "testing" },
        approverUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires reference number when marking filed", async () => {
    await expect(
      markTaxCalendarFiled(
        {
          occurrenceKey: "1701q|2026-Q3",
          filedDateYmd: "2026-11-03",
          referenceNo: "   ",
          file: { name: "confirm.pdf", size: 10, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
        },
        adminUser,
      ),
    ).rejects.toThrow(/Enter the BIR filing reference number/i);
  });

  it("requires confirmation file when marking filed", async () => {
    await expect(
      markTaxCalendarFiled(
        {
          occurrenceKey: "1701q|2026-Q3",
          filedDateYmd: "2026-11-03",
          referenceNo: "TEST-REF-001",
          file: { name: "", size: 0, bytes: new Uint8Array([]) },
        },
        adminUser,
      ),
    ).rejects.toThrow(/Attach the eFPS or eBIRForms confirmation/i);
  });

  it("requires a non-empty reason when undoing a filing", async () => {
    await expect(
      undoTaxCalendarFiled(
        { occurrenceKey: "1701q|2026-Q3", reason: "   " },
        adminUser,
      ),
    ).rejects.toThrow(/Provide a reason for undoing this filing/i);
  });
});
