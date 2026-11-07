import { describe, expect, it } from "vitest";
import { itemSchema } from "@/lib/validation/items";

const base = {
  name: "Anthropic Claude Max 5x Plan",
  brand: "Anthropic",
  model: "Claude Max 5x",
  category: "Software",
  sku: "CLAUDE-MAX-5X",
  unit: "pc",
  kind: "GOODS",
  details: "12 months",
  defaultUnitPrice: "133333.33",
} as const;

describe("itemSchema", () => {
  it("accepts a full item and strips commas from the price", () => {
    const parsed = itemSchema().safeParse({ ...base, defaultUnitPrice: "133,333.33" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Anthropic Claude Max 5x Plan");
      expect(parsed.data.defaultUnitPrice).toBe("133333.33");
      expect(parsed.data.kind).toBe("GOODS");
    }
  });

  it("accepts a minimal item: blanks become null, price stays unset", () => {
    const parsed = itemSchema().safeParse({
      name: "E2E Laptop",
      brand: "",
      model: "",
      category: "",
      sku: "",
      unit: "pc",
      kind: "GOODS",
      details: "",
      defaultUnitPrice: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.brand).toBeNull();
      expect(parsed.data.model).toBeNull();
      expect(parsed.data.category).toBeNull();
      expect(parsed.data.sku).toBeNull();
      expect(parsed.data.details).toBeNull();
      expect(parsed.data.defaultUnitPrice).toBeNull();
    }
  });

  it("accepts SERVICES kind", () => {
    const parsed = itemSchema().safeParse({ ...base, kind: "SERVICES", defaultUnitPrice: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing name", () => {
    const parsed = itemSchema().safeParse({ ...base, name: "  " });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["name"]);
  });

  it("rejects a name over 191 characters", () => {
    const parsed = itemSchema().safeParse({ ...base, name: "x".repeat(192) });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing unit", () => {
    const parsed = itemSchema().safeParse({ ...base, unit: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["unit"]);
  });

  it("rejects an unknown kind", () => {
    const parsed = itemSchema().safeParse({ ...base, kind: "OTHER" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a price with 3 decimals, a negative price, and a non-number", () => {
    for (const bad of ["12.345", "-5", "abc"]) {
      const parsed = itemSchema().safeParse({ ...base, defaultUnitPrice: bad });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["defaultUnitPrice"]);
    }
  });

  it("accepts a whole-peso price", () => {
    const parsed = itemSchema().safeParse({ ...base, defaultUnitPrice: "50000" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.defaultUnitPrice).toBe("50000");
  });
});
