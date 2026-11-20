// Phase 4 #10 step 4: Books Period close card rendering (plan P7, K5's
// UI half). Non-Admins see the closed-months list read-only; Admins get
// the close form (default = last month) and a Reopen control with a
// required reason field per closed month. The actions/service re-check
// Admin + flag server-side — these tests pin only what the card shows.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeriodCloseCard, type PeriodLockRow } from "@/components/books/PeriodCloseCard";

const CLOSED: PeriodLockRow = {
  yearMonth: "2026-10",
  closed: true,
  closedAt: "2026-11-05T00:00:00.000Z",
  reopenedAt: null,
  reopenReason: null,
};
const REOPENED: PeriodLockRow = {
  yearMonth: "2026-09",
  closed: false,
  closedAt: "2026-10-03T00:00:00.000Z",
  reopenedAt: "2026-10-10T00:00:00.000Z",
  reopenReason: "Fix a late bill",
};

describe("PeriodCloseCard", () => {
  it("shows the closed list read-only to non-Admins, with no close or reopen controls", () => {
    const html = renderToStaticMarkup(
      createElement(PeriodCloseCard, { locks: [CLOSED, REOPENED], isAdmin: false, defaultMonth: "2026-10" }),
    );
    expect(html).toContain("October 2026");
    expect(html).toContain("closed");
    expect(html).toContain("September 2026");
    expect(html).toContain("Fix a late bill");
    expect(html).toContain("Only an Admin can close or reopen a month.");
    expect(html).not.toContain("Close month");
    expect(html).not.toContain('name="reason"');
    expect(html).not.toContain('type="month"');
  });

  it("gives Admins the close form defaulted to last month and a reason-required reopen form", () => {
    const html = renderToStaticMarkup(
      createElement(PeriodCloseCard, { locks: [CLOSED], isAdmin: true, defaultMonth: "2026-10" }),
    );
    expect(html).toContain('type="month"');
    expect(html).toContain('value="2026-10"');
    expect(html).toContain("Close month");
    expect(html).toContain("Reopen");
    expect(html).toContain("Reason for reopening (required)");
    expect(html).toContain('name="reason"');
    expect(html).toContain("required");
  });

  it("says plainly when no month is closed", () => {
    const html = renderToStaticMarkup(
      createElement(PeriodCloseCard, { locks: [], isAdmin: true, defaultMonth: "2026-10" }),
    );
    expect(html).toContain("No months are closed.");
  });
});
