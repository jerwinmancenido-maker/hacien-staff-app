import { describe, expect, it } from "vitest";
import {
  defaultQuoteValidityDays,
  parseManilaYmd,
  validUntilFromDays,
  validityDaysFromDates,
  validateQuoteValidity,
  MIN_QUOTE_VALIDITY_DAYS,
} from "@/lib/quotes/validity";
import { quoteInputSchema } from "@/lib/validation/quotes";
import { addDays, isoDate, manilaToday } from "@/lib/format";

describe("quote validity date math — days -> date", () => {
  it("calculates validUntil date from quote date and days (string input)", () => {
    expect(validUntilFromDays("2026-11-02", 15)).toBe("2026-11-17");
    expect(validUntilFromDays("2026-11-02", 1)).toBe("2026-11-03");
    expect(validUntilFromDays("2026-11-02", 30)).toBe("2026-12-02");
    expect(validUntilFromDays("2026-11-02", 60)).toBe("2027-01-01");
  });

  it("calculates validUntil date from Date objects", () => {
    const base = new Date("2026-11-02T00:00:00.000Z");
    expect(validUntilFromDays(base, 15)).toBe("2026-11-17");
    expect(validUntilFromDays(base, 1)).toBe("2026-11-03");
  });

  it("returns null on invalid date or non-finite days", () => {
    expect(validUntilFromDays("", 15)).toBeNull();
    expect(validUntilFromDays("invalid", 15)).toBeNull();
    expect(validUntilFromDays("2026-11-02", Number.NaN)).toBeNull();
  });
});

describe("quote validity date math — date -> days", () => {
  it("calculates days from quote date and validUntil date (string inputs)", () => {
    expect(validityDaysFromDates("2026-11-02", "2026-11-17")).toBe(15);
    expect(validityDaysFromDates("2026-11-02", "2026-11-03")).toBe(1);
    expect(validityDaysFromDates("2026-11-02", "2026-12-02")).toBe(30);
  });

  it("is exact inverse of days -> date", () => {
    const base = "2026-11-02";
    for (const days of [1, 7, 15, 30, 45, 90, 180, 365]) {
      const until = validUntilFromDays(base, days);
      expect(until).not.toBeNull();
      expect(validityDaysFromDates(base, until!)).toBe(days);
    }
  });

  it("calculates days from Date objects", () => {
    const d1 = new Date("2026-11-02T00:00:00.000Z");
    const d2 = new Date("2026-11-17T00:00:00.000Z");
    expect(validityDaysFromDates(d1, d2)).toBe(15);
  });

  it("returns 0 for same day and negative for earlier date", () => {
    expect(validityDaysFromDates("2026-11-02", "2026-11-02")).toBe(0);
    expect(validityDaysFromDates("2026-11-02", "2026-11-01")).toBe(-1);
    expect(validityDaysFromDates("2026-11-02", "2026-10-15")).toBe(-18);
  });

  it("returns null for missing or invalid dates", () => {
    expect(validityDaysFromDates("", "2026-11-17")).toBeNull();
    expect(validityDaysFromDates("2026-11-02", "")).toBeNull();
    expect(validityDaysFromDates(null, "2026-11-17")).toBeNull();
  });
});

describe("quote validity date math — default from Settings", () => {
  it("uses DEFAULT_QUOTE_VALIDITY_DAYS (15) when settings is missing or undefined", () => {
    expect(defaultQuoteValidityDays(null)).toBe(15);
    expect(defaultQuoteValidityDays(undefined)).toBe(15);
    expect(defaultQuoteValidityDays({})).toBe(15);
    expect(defaultQuoteValidityDays({ quotes: {} })).toBe(15);
  });

  it("reads defaultValidityDays from Settings when present", () => {
    expect(defaultQuoteValidityDays({ quotes: { defaultValidityDays: 30 } })).toBe(30);
    expect(defaultQuoteValidityDays({ quotes: { defaultValidityDays: 45 } })).toBe(45);
    expect(defaultQuoteValidityDays({ quotes: { defaultValidityDays: 1 } })).toBe(1);
  });

  it("enforces minimum 1 day even if settings contains 0 or negative", () => {
    expect(defaultQuoteValidityDays({ quotes: { defaultValidityDays: 0 } })).toBe(MIN_QUOTE_VALIDITY_DAYS);
    expect(defaultQuoteValidityDays({ quotes: { defaultValidityDays: -10 } })).toBe(MIN_QUOTE_VALIDITY_DAYS);
  });
});

describe("quote validity date math — minimum 1 and validation", () => {
  it("accepts minimum 1 day in pure validation helper", () => {
    const res = validateQuoteValidity("2026-11-02", "2026-11-03");
    expect(res.valid).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it("rejects 0 days (same date) with At least 1 day", () => {
    const res = validateQuoteValidity("2026-11-02", "2026-11-02");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("At least 1 day.");
  });

  it("rejects date before quote date with Valid until can't be before the quote date", () => {
    const res = validateQuoteValidity("2026-11-02", "2026-11-01");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Valid until can't be before the quote date.");
  });

  it("server schema rejects validUntil before quote date", () => {
    const today = manilaToday();
    const parsed = quoteInputSchema.safeParse({
      customerId: "cust_1",
      contactId: null,
      date: isoDate(today),
      validUntil: isoDate(addDays(today, -1)),
      terms: "",
      notes: "",
      items: [{ id: null, description: "Item", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "100" }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.includes("validUntil"));
      expect(issue?.message).toBe("Valid until can't be before the quote date.");
    }
  });

  it("server schema rejects validUntil on same day (0 days) with At least 1 day", () => {
    const today = manilaToday();
    const parsed = quoteInputSchema.safeParse({
      customerId: "cust_1",
      contactId: null,
      date: isoDate(today),
      validUntil: isoDate(today),
      terms: "",
      notes: "",
      items: [{ id: null, description: "Item", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "100" }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.includes("validUntil"));
      expect(issue?.message).toBe("At least 1 day.");
    }
  });

  it("server schema rejects validForDays < 1", () => {
    const today = manilaToday();
    const parsed = quoteInputSchema.safeParse({
      customerId: "cust_1",
      contactId: null,
      date: isoDate(today),
      validUntil: isoDate(addDays(today, 15)),
      validForDays: 0,
      terms: "",
      notes: "",
      items: [{ id: null, description: "Item", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "100" }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.includes("validForDays"));
      expect(issue?.message).toBe("At least 1 day.");
    }
  });

  it("server schema accepts valid quote with validForDays >= 1 and validUntil >= 1 day", () => {
    const today = manilaToday();
    const parsed = quoteInputSchema.safeParse({
      customerId: "cust_1",
      contactId: null,
      date: isoDate(today),
      validUntil: isoDate(addDays(today, 1)),
      validForDays: 1,
      terms: "",
      notes: "",
      items: [{ id: null, description: "Item", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "100" }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("quote validity date math — month and year rollover in Asia/Manila (PHT)", () => {
  it("rolls over month across a 30-day month (November -> December)", () => {
    // Nov has 30 days: Nov 20 + 15 days = Dec 5
    expect(validUntilFromDays("2026-11-20", 15)).toBe("2026-12-05");
    expect(validityDaysFromDates("2026-11-20", "2026-12-05")).toBe(15);
  });

  it("rolls over month across a 31-day month (July -> August)", () => {
    // July has 31 days: July 25 + 10 days = Aug 4
    expect(validUntilFromDays("2026-07-25", 10)).toBe("2026-08-04");
    expect(validityDaysFromDates("2026-07-25", "2026-08-04")).toBe(10);
  });

  it("rolls over month across February in a common year (28 days)", () => {
    // 2026 is non-leap: Feb has 28 days: Feb 20 + 10 days = Mar 2
    expect(validUntilFromDays("2026-02-20", 10)).toBe("2026-03-02");
    expect(validityDaysFromDates("2026-02-20", "2026-03-02")).toBe(10);
  });

  it("rolls over month across February in a leap year (29 days)", () => {
    // 2028 is leap: Feb has 29 days: Feb 20 + 10 days = Mar 1
    expect(validUntilFromDays("2028-02-20", 10)).toBe("2028-03-01");
    expect(validityDaysFromDates("2028-02-20", "2028-03-01")).toBe(10);
  });

  it("rolls over year (December -> January next year)", () => {
    // Dec 25, 2026 + 15 days = Jan 9, 2027
    expect(validUntilFromDays("2026-12-25", 15)).toBe("2027-01-09");
    expect(validityDaysFromDates("2026-12-25", "2027-01-09")).toBe(15);
  });

  it("correctly handles Manila calendar day boundaries without DST distortion", () => {
    // Asia/Manila (PHT) is UTC+8 with no Daylight Saving Time.
    // 00:00 UTC corresponds to 08:00 Manila of the same calendar day.
    const nov30Utc = new Date("2026-11-30T00:00:00.000Z");
    const parsed = parseManilaYmd(nov30Utc);
    expect(parsed).toEqual([2026, 11, 30]);

    // Stepping 1 day crosses into December
    expect(validUntilFromDays(nov30Utc, 1)).toBe("2026-12-01");
    expect(validityDaysFromDates(nov30Utc, "2026-12-01")).toBe(1);

    // Stepping 32 days crosses into 2027
    expect(validUntilFromDays(nov30Utc, 32)).toBe("2027-01-01");
    expect(validityDaysFromDates(nov30Utc, "2027-01-01")).toBe(32);
  });
});
