import { describe, expect, it } from "vitest";
import { BRAND_LETTERHEAD_LOGO, printCompanyBlock } from "@/lib/print/company";

describe("brand letterhead logo", () => {
  it("defaults to public/brand/logo-full.svg when no settings logo is uploaded", () => {
    expect(BRAND_LETTERHEAD_LOGO).toBe("/brand/logo-full.svg");
    const block = printCompanyBlock({
      name: "HACIEN Sample Trading Co.",
      tradeName: "HACIEN",
      tin: "000-000-000-00000",
      address: "Sample St.",
      phone: "",
      email: "billing@example.com",
      website: "",
      logoStorageKey: "",
    });
    expect(block.logoUrl).toBe("/brand/logo-full.svg");
  });

  it("lets a Settings upload override the brand kit logo", () => {
    const block = printCompanyBlock({
      name: "HACIEN Sample Trading Co.",
      tradeName: "HACIEN",
      tin: "000-000-000-00000",
      address: "Sample St.",
      phone: "",
      email: "",
      website: "",
      logoStorageKey: "company-logo-abc",
    });
    expect(block.logoUrl).toBe("/files/company-logo");
  });
});
