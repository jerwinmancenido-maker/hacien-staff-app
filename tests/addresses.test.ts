// Structured Philippine addresses: validation, ZIP, formatter, default and owner rules.

import { describe, expect, it } from "vitest";
import { barangayLabel, formatAddress } from "@/lib/addresses/format";
import { defaultsPlan, ownerError, supplierAddressError } from "@/lib/addresses/rules";
import { addressSchema, isValidZip } from "@/lib/validation/addresses";

const full = {
  street: "Unit 4B, Sample Tower, 12 Rizal St.",
  barangay: "San Antonio",
  cityMunicipality: "Pasig City",
  province: "Metro Manila",
  zip: "1605",
};

describe("formatAddress", () => {
  it("formats one line", () => {
    expect(formatAddress(full)).toBe("Unit 4B, Sample Tower, 12 Rizal St., Brgy. San Antonio, Pasig City, Metro Manila 1605");
  });

  it("formats several lines", () => {
    expect(formatAddress(full, { multiline: true })).toBe("Unit 4B, Sample Tower, 12 Rizal St.\nBrgy. San Antonio, Pasig City\nMetro Manila 1605");
  });

  it("keeps the street's own line breaks on multi-line and joins them on one line", () => {
    const a = { ...full, street: "Unit 4B, Sample Tower\n12 Rizal St." };
    expect(formatAddress(a, { multiline: true }).split("\n")).toEqual(["Unit 4B, Sample Tower", "12 Rizal St.", "Brgy. San Antonio, Pasig City", "Metro Manila 1605"]);
    expect(formatAddress(a)).toBe("Unit 4B, Sample Tower, 12 Rizal St., Brgy. San Antonio, Pasig City, Metro Manila 1605");
  });

  it("skips blank parts (addresses copied from the old free-text field)", () => {
    const legacy = { street: "Sample Tower, Ortigas Center, Pasig City", barangay: "", cityMunicipality: "", province: "", zip: "" };
    expect(formatAddress(legacy)).toBe("Sample Tower, Ortigas Center, Pasig City");
    expect(formatAddress(legacy, { multiline: true })).toBe("Sample Tower, Ortigas Center, Pasig City");
  });

  it("doesn't double the barangay prefix", () => {
    expect(barangayLabel("Brgy. Poblacion")).toBe("Brgy. Poblacion");
    expect(barangayLabel("Barangay 659")).toBe("Barangay 659");
    expect(barangayLabel("bgy Central")).toBe("bgy Central");
    expect(barangayLabel("Ugong")).toBe("Brgy. Ugong");
    expect(barangayLabel("  ")).toBe("");
  });
});

describe("address validation", () => {
  const input = { kind: "BILLING", label: "", isDefault: false, ...full };

  it("accepts a full address and trims it", () => {
    const r = addressSchema.safeParse({ ...input, street: "  12 Rizal St. ", zip: " 1605 " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.street).toBe("12 Rizal St.");
      expect(r.data.zip).toBe("1605");
      expect(r.data.label).toBeNull();
    }
  });

  it("requires street, barangay, city / municipality and province", () => {
    const r = addressSchema.safeParse({ ...input, street: " ", barangay: "", cityMunicipality: "", province: "" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["street", "barangay", "cityMunicipality", "province"]));
  });

  it("ZIP is exactly 4 digits", () => {
    for (const ok of ["1605", "0000", "9811"]) expect(isValidZip(ok), ok).toBe(true);
    for (const bad of ["160", "16055", "16O5", "", "1 605", "-160"]) expect(isValidZip(bad), bad).toBe(false);
    expect(addressSchema.safeParse({ ...input, zip: "160" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...input, zip: "abcd" }).success).toBe(false);
  });

  it("only allows the known kinds", () => {
    expect(addressSchema.safeParse({ ...input, kind: "HOME" }).success).toBe(false);
    for (const kind of ["BILLING", "DELIVERY", "OFFICE", "WAREHOUSE", "OTHER"]) expect(addressSchema.safeParse({ ...input, kind }).success).toBe(true);
  });
});

describe("address rules", () => {
  it("an address has exactly one owner", () => {
    expect(ownerError({ customerId: "c1" })).toBeNull();
    expect(ownerError({ supplierId: "s1" })).toBeNull();
    expect(ownerError({})).toMatch(/needs a customer or a supplier/);
    expect(ownerError({ customerId: "c1", supplierId: "s1" })).toMatch(/not both/);
  });

  const at = (n: number) => new Date(Date.UTC(2026, 0, n));

  it("one default per kind: the first of a kind becomes default", () => {
    expect(defaultsPlan([{ id: "a", kind: "BILLING", isDefault: false, createdAt: at(1) }])).toEqual({ set: ["a"], unset: [] });
  });

  it("a preferred address takes over its kind's default only", () => {
    const rows = [
      { id: "b1", kind: "BILLING" as const, isDefault: true, createdAt: at(1) },
      { id: "b2", kind: "BILLING" as const, isDefault: false, createdAt: at(2) },
      { id: "d1", kind: "DELIVERY" as const, isDefault: true, createdAt: at(3) },
    ];
    expect(defaultsPlan(rows, "b2")).toEqual({ set: ["b2"], unset: ["b1"] });
    expect(defaultsPlan(rows)).toEqual({ set: [], unset: [] });
  });

  it("repairs two defaults of one kind by keeping the newest", () => {
    const rows = [
      { id: "old", kind: "DELIVERY" as const, isDefault: true, createdAt: at(1) },
      { id: "new", kind: "DELIVERY" as const, isDefault: true, createdAt: at(5) },
    ];
    expect(defaultsPlan(rows)).toEqual({ set: [], unset: ["old"] });
  });

  it("suppliers need an office or billing address", () => {
    expect(supplierAddressError([{ kind: "OFFICE" }])).toBeNull();
    expect(supplierAddressError([{ kind: "WAREHOUSE" }, { kind: "BILLING" }])).toBeNull();
    expect(supplierAddressError([{ kind: "DELIVERY" }])).toMatch(/office or billing/);
    expect(supplierAddressError([])).toMatch(/office or billing/);
  });
});
