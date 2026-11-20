import { describe, expect, it } from "vitest";
import { addDays, manilaToday } from "@/lib/format";
import { isWarrantyEndingSoon, WARRANTY_SOON_DAYS } from "@/lib/purchasing/warranty-soon";

describe("SL-05 isWarrantyEndingSoon", () => {
  const today = manilaToday(new Date("2026-11-12T04:00:00+08:00"));

  it("includes today", () => {
    expect(isWarrantyEndingSoon(today, today)).toBe(true);
  });

  it("includes day 30", () => {
    expect(isWarrantyEndingSoon(addDays(today, WARRANTY_SOON_DAYS), today)).toBe(true);
  });

  it("excludes day 31", () => {
    expect(isWarrantyEndingSoon(addDays(today, WARRANTY_SOON_DAYS + 1), today)).toBe(false);
  });

  it("excludes yesterday", () => {
    expect(isWarrantyEndingSoon(addDays(today, -1), today)).toBe(false);
  });

  it("excludes null and undefined", () => {
    expect(isWarrantyEndingSoon(null, today)).toBe(false);
    expect(isWarrantyEndingSoon(undefined, today)).toBe(false);
  });
});
