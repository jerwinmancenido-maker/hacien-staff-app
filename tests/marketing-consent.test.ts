import { describe, expect, it, vi } from "vitest";

// Q17 S-96: marketing consent — pure logic only (business days, tokens,
// suppression guard, CSV filter). DB-backed flows (history writes,
// suppression upserts) are covered by the same functions and skip here
// because no local MySQL is available in this environment.

vi.stubEnv("SESSION_SECRET", "test-only-dummy-secret-1234");

import {
  addBusinessDaysManila,
  emailOptInBlocked,
  optedInContactsToCsv,
  optedInCsvRows,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/marketing-consent";

describe("addBusinessDaysManila", () => {
  it("skips weekends: Friday + 3 business days = Wednesday", () => {
    // 2026-11-06 is a Friday (Asia/Manila).
    const due = addBusinessDaysManila(new Date("2026-11-06T02:00:00Z"), 3);
    expect(due.toISOString()).toBe("2026-11-10T16:00:00.000Z"); // Wed 2026-11-11, Manila midnight
  });
  it("Monday + 3 business days = Thursday", () => {
    const due = addBusinessDaysManila(new Date("2026-11-09T02:00:00Z"), 3);
    expect(due.toISOString()).toBe("2026-11-11T16:00:00.000Z"); // Thu 2026-11-12, Manila midnight
  });
  it("a Saturday start counts from Monday", () => {
    const due = addBusinessDaysManila(new Date("2026-11-07T02:00:00Z"), 1);
    expect(due.toISOString()).toBe("2026-11-08T16:00:00.000Z"); // Mon 2026-11-09, Manila midnight
  });
});

describe("unsubscribe token", () => {
  const now = new Date("2026-11-04T00:00:00Z");
  it("round-trips contact id + lower-cased email", () => {
    const token = signUnsubscribeToken("c1", "Person@Example.com", now);
    expect(verifyUnsubscribeToken(token, now)).toEqual({ contactId: "c1", email: "person@example.com" });
  });
  it("rejects a tampered token", () => {
    const token = signUnsubscribeToken("c1", "person@example.com", now);
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifyUnsubscribeToken(tampered, now)).toBeNull();
  });
  it("rejects an expired token", () => {
    const token = signUnsubscribeToken("c1", "person@example.com", now);
    const later = new Date(now.getTime() + 181 * 24 * 60 * 60 * 1000);
    expect(verifyUnsubscribeToken(token, later)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifyUnsubscribeToken("not-a-token", now)).toBeNull();
    expect(verifyUnsubscribeToken("", now)).toBeNull();
  });
});

describe("suppression guard", () => {
  it("blocks opt-in while suppression is active, allows it after an explicit clear", () => {
    expect(emailOptInBlocked({ clearedAt: null })).toBe(true);
    expect(emailOptInBlocked({ clearedAt: new Date() })).toBe(false);
    expect(emailOptInBlocked(null)).toBe(false);
  });
});

describe("opted-in CSV export", () => {
  const base = {
    name: "Ana Santos",
    companyName: "Santos Trading",
    companyType: "customer" as const,
    email: "ana@example.com",
    phone: "09171234567",
    emailConsent: true,
    smsConsent: false,
    emailSuppressed: false,
  };
  it("includes opted-in contacts and skips consent-off ones", () => {
    const rows = optedInCsvRows([
      base,
      { ...base, name: "No Consent", emailConsent: false },
      { ...base, name: "Suppressed", emailSuppressed: true },
      { ...base, name: "Sms Only", emailConsent: false, smsConsent: true },
    ]);
    expect(rows.map((r) => r[0])).toEqual(["Ana Santos", "Sms Only"]);
    // Suppressed email is excluded even though email consent is on.
    expect(rows.find((r) => r[0] === "Suppressed")).toBeUndefined();
  });
  it("excludes an email-consent row with no email on file", () => {
    expect(optedInCsvRows([{ ...base, email: null }])).toEqual([]);
  });
  it("escapes commas and quotes in CSV output", () => {
    const csv = optedInContactsToCsv([{ ...base, companyName: 'Santos, "Trading" Corp' }]);
    expect(csv.split("\r\n")[0]).toBe(
      "contact_name,company_name,company_type,email,phone,email_consent,sms_consent,email_suppressed",
    );
    expect(csv).toContain('"Santos, ""Trading"" Corp"');
  });
});
