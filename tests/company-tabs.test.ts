// Customer / supplier detail tab routing (?tab=…).

import { describe, expect, it } from "vitest";
import { COMPANY_TABS, resolveCompanyTab } from "@/lib/company-tabs";

describe("resolveCompanyTab", () => {
  it("defaults to overview", () => {
    expect(resolveCompanyTab(undefined)).toBe("overview");
    expect(resolveCompanyTab("")).toBe("overview");
    expect(resolveCompanyTab("nope")).toBe("overview");
  });

  it("accepts every company tab including addresses", () => {
    for (const tab of COMPANY_TABS) {
      expect(resolveCompanyTab(tab)).toBe(tab);
    }
    expect(COMPANY_TABS.indexOf("addresses")).toBe(COMPANY_TABS.indexOf("details") + 1);
  });

  it("maps the old history alias to transactions", () => {
    expect(resolveCompanyTab("history")).toBe("transactions");
  });
});
