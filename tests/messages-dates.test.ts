// Fix batch 3, PR-15 unit pins:
//  F27 — blank bank-detail fields refuse with friendly words, not
//        raw Zod text ("Too small: expected string to have >=1…").
//  F28 — the access-review age counts MANILA calendar days: a review
//        marked at 06:52 PHT (22:52 UTC the day before) is "today".
//  F34 — the closed-month refusal names the month and an Admin, and
//        never points at the Period close card (hidden while the
//        period-close feature is off).
//  F26 — wiring guard: the quote page passes hiddenReasons into
//        QuoteActions, and the menu holds send actions back on it.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accessReviewDue, accessReviewLabel } from "@/lib/access-review";
import { closedPeriodMessage } from "@/lib/period-close-shared";
import { settingsSections } from "@/lib/settings/schema";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("F27 friendly bank-detail messages", () => {
  it("blank bank name / account name / provider get plain words", () => {
    const bankSchema = settingsSections.print.shape.banks.element;
    const bank = bankSchema.safeParse({ bankName: " ", accountName: "", accountLast4: "1234", printFullAccountNumber: false });
    expect(bank.success).toBe(false);
    const text = JSON.stringify(bank.success ? {} : bank.error.issues);
    expect(text).toContain("Enter the bank name.");
    expect(text).toContain("Enter the account name.");
    expect(text).not.toContain("Too small");

    const walletSchema = settingsSections.print.shape.eWallets.element;
    const wallet = walletSchema.safeParse({ provider: "", accountName: "X", accountLast4: "1234", printFullAccountNumber: false });
    expect(wallet.success).toBe(false);
    const wtext = JSON.stringify(wallet.success ? {} : wallet.error.issues);
    expect(wtext).toContain("Enter the provider.");
    expect(wtext).not.toContain("Too small");
  });
});

describe("F28 access-review age in Manila days", () => {
  it("a review marked 06:52 PHT reads as reviewed today that morning", () => {
    // 2026-11-18T22:52:00Z = Nov 19, 06:52 in Manila.
    const marked = new Date("2026-11-18T22:52:00.000Z");
    const now = new Date("2026-11-18T23:30:00.000Z"); // Nov 19, 07:30 PHT
    expect(accessReviewLabel(marked, now)).toBe("Reviewed today");
    expect(accessReviewDue(marked, now)).toBe(false);
  });

  it("the 90-day boundary still counts whole Manila days", () => {
    const now = new Date("2026-11-19T00:00:00.000Z"); // Nov 19, 08:00 PHT
    // Manila Aug 21 = 90 days before Nov 19: not yet due (due is > 90).
    expect(accessReviewLabel(new Date("2026-08-20T16:00:00.000Z"), now)).toBe("Reviewed 90 days ago");
    expect(accessReviewDue(new Date("2026-08-20T16:00:00.000Z"), now)).toBe(false);
    // Manila Aug 20 = 91 days: due.
    expect(accessReviewDue(new Date("2026-08-19T16:00:00.000Z"), now)).toBe(true);
  });
});

describe("F34 closed-month message", () => {
  it("names the month and an Admin, with no hidden-card pointer", () => {
    const msg = closedPeriodMessage("2026-03");
    expect(msg).toContain("March 2026 is closed.");
    expect(msg).toContain("Admin");
    expect(msg).not.toContain("Period close");
  });
});

describe("F26 hidden-reason wiring", () => {
  it("the quote page passes hiddenReasons and the menu blocks on it", () => {
    const page = read("src/app/(app)/quotes/[id]/page.tsx");
    expect(page).toContain("approvalReasonsHidden={q.approval.hiddenReasons ?? false}");
    const actions = read("src/components/docs/QuoteActions.tsx");
    expect(actions).toContain("blockedHidden");
    expect(actions).toContain("Waiting for approval — an Approver or Admin must approve it before it can be sent or converted");
  });
});
