// Phase 4 #10: period close — pure helpers, the guard, and the
// close/reopen input discipline (K5 halves that need no DB).
// The guarded posting paths themselves are covered per-path in
// tests/db (P4-3); close/reopen state changes land in step 2-3's
// db suite alongside the Tier 1 guards.

import { describe, expect, it } from "vitest";
import {
  closedPeriodMessage,
  isValidYearMonth,
  monthLabel,
  periodCloseEnabledFromEnv,
  yearMonthOf,
} from "@/lib/period-close-shared";
import { assertPeriodOpen, closePeriod, reopenPeriod } from "@/lib/services/period-close";
import { DocRuleError } from "@/lib/documents/common";
import { ForbiddenError } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import type { Tx } from "@/lib/db";

const ADMIN = { id: "admin-1", active: true, isAdmin: true, isApprover: false, isStaff: false, isViewer: false, canSeeCosts: true };
const STAFF = { id: "staff-1", active: true, isAdmin: false, isApprover: false, isStaff: true, isViewer: false, canSeeCosts: false };

function fakeTx(row: { closed: boolean } | null) {
  return {
    periodLock: { findUnique: async () => row },
  } as unknown as Tx;
}

describe("period key + labels", () => {
  it("derives YYYY-MM from the UTC year/month", () => {
    expect(yearMonthOf(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(yearMonthOf(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01");
    // A date stored as @db.Date at UTC midnight never bleeds into the next month.
    expect(yearMonthOf(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
  });

  it("validates the YYYY-MM shape", () => {
    expect(isValidYearMonth("2026-11")).toBe(true);
    expect(isValidYearMonth("2026-13")).toBe(false);
    expect(isValidYearMonth("2026-00")).toBe(false);
    expect(isValidYearMonth("26-11")).toBe(false);
    expect(isValidYearMonth("2026-1")).toBe(false);
  });

  it("labels months in plain words and names the month in the refusal", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(closedPeriodMessage("2026-11")).toBe(
      "November 2026 is closed. An Admin can reopen it under Books → Period close.",
    );
  });
});

describe("assertPeriodOpen (the ONE guard)", () => {
  it("passes when there is no lock row (open by default)", async () => {
    await expect(assertPeriodOpen(fakeTx(null), new Date("2026-11-15T00:00:00Z"))).resolves.toBeUndefined();
  });

  it("passes when the row exists but is not closed", async () => {
    await expect(assertPeriodOpen(fakeTx({ closed: false }), new Date("2026-11-15T00:00:00Z"))).resolves.toBeUndefined();
  });

  it("refuses a closed month with the plain message naming it", async () => {
    await expect(assertPeriodOpen(fakeTx({ closed: true }), new Date("2026-11-15T00:00:00Z"))).rejects.toThrow(DocRuleError);
    await expect(assertPeriodOpen(fakeTx({ closed: true }), new Date("2026-11-15T00:00:00Z"))).rejects.toThrow(
      "November 2026 is closed.",
    );
  });
});

describe("close/reopen discipline (validated before any DB write)", () => {
  it("is Admin-only", async () => {
    await expect(closePeriod("2026-10", STAFF)).rejects.toThrow(ForbiddenError);
    await expect(reopenPeriod("2026-10", "fix a typo", STAFF)).rejects.toThrow(ForbiddenError);
  });

  it("refuses a malformed month and a future month", async () => {
    await expect(closePeriod("2026-13", ADMIN)).rejects.toThrow(DocRuleError);
    const future = yearMonthOf(new Date(Date.now() + 40 * 24 * 3600 * 1000));
    await expect(closePeriod(future, ADMIN)).rejects.toThrow(DocRuleError);
  });

  it("reopen needs a typed reason, at most 500 characters", async () => {
    await expect(reopenPeriod("2026-10", "   ", ADMIN)).rejects.toThrow(DocRuleError);
    await expect(reopenPeriod("2026-10", "x".repeat(501), ADMIN)).rejects.toThrow(DocRuleError);
  });
});

describe("periodCloseEnabled flag", () => {
  it("defaults OFF in settings", () => {
    expect(DEFAULT_SETTINGS.features.periodCloseEnabled).toBe(false);
  });

  it("reads the env override", () => {
    expect(periodCloseEnabledFromEnv({ PERIOD_CLOSE_ENABLED: "true" })).toBe(true);
    expect(periodCloseEnabledFromEnv({ PERIOD_CLOSE_ENABLED: "0" })).toBe(false);
    expect(periodCloseEnabledFromEnv({})).toBe(null);
    expect(periodCloseEnabledFromEnv({ PERIOD_CLOSE_ENABLED: "banana" })).toBe(null);
  });
});
