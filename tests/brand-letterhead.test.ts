import { describe, expect, it } from "vitest";
import { BRAND_LETTERHEAD_LOGO, mergeCompanyLetterhead, printCompanyBlock } from "@/lib/print/company";

const base = {
  name: "HACIEN Sample Trading Co.",
  tradeName: "HACIEN",
  tin: "000-000-000-00000",
  address: "Sample St.",
  phone: "",
  email: "billing@example.com",
  website: "",
  logoStorageKey: "",
};

describe("mergeCompanyLetterhead", () => {
  it("uses current Settings when there is no pin", () => {
    expect(mergeCompanyLetterhead(null, base)).toEqual(base);
  });

  it("falls back field-by-field when the pin is blank", () => {
    const merged = mergeCompanyLetterhead(
      { ...base, tin: "", address: "  ", phone: "+63 2 1111" },
      { ...base, tin: "123-456-789-000", address: "QC", phone: "+63 2 9999" },
    );
    expect(merged.tin).toBe("123-456-789-000");
    expect(merged.address).toBe("QC");
    expect(merged.phone).toBe("+63 2 1111");
  });

  it("keeps non-blank pinned values over a different current TIN/address", () => {
    const merged = mergeCompanyLetterhead(
      { ...base, tin: "111-222-333-000", address: "Makati" },
      { ...base, tin: "999-888-777-000", address: "Pasig", name: "Renamed Co." },
    );
    expect(merged.tin).toBe("111-222-333-000");
    expect(merged.address).toBe("Makati");
    expect(merged.name).toBe("HACIEN Sample Trading Co.");
  });
});

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
