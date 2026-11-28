// ERP adoption item 10 — payment-term presets.
//
// A preset is a typing shortcut: picking one fills the Quote / SO terms
// field with the preset's text, and the document stores ONLY that text.
// These tests pin the seed (names item 14 will key on, texts that print
// exactly what the same terms string prints today) and the schema rules.

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import {
  PAYMENT_TERM_PRESET_SEED,
  activePaymentTermPresets,
  paymentTermPresetsSchema,
  settingsSections,
} from "@/lib/settings/schema";
import { COD_POINT2_TEXT, quoteSoTermsPoint2, resolvePaymentTerm } from "@/lib/print/terms-block";

describe("payment term preset seed", () => {
  it("matches the defaults seed exactly", () => {
    expect(DEFAULT_SETTINGS.lists.paymentTermPresets).toEqual(PAYMENT_TERM_PRESET_SEED);
  });

  it("carries the names the printed schedule keys on, exactly", () => {
    const names = PAYMENT_TERM_PRESET_SEED.map((p) => p.name);
    expect(names).toContain("COD");
    expect(names).toContain("50/50");
    expect(names).toContain("Net 30");
    expect(names).toContain("100% upfront");
    expect(PAYMENT_TERM_PRESET_SEED.every((p) => p.active)).toBe(true);
  });

  it("uses only texts already offered in the payment terms list, so prints are unchanged", () => {
    for (const preset of PAYMENT_TERM_PRESET_SEED) {
      expect(DEFAULT_SETTINGS.lists.paymentTerms).toContain(preset.text);
    }
  });

  it("resolves each seed text to the payment kind its name promises", () => {
    const byName = new Map(PAYMENT_TERM_PRESET_SEED.map((p) => [p.name, p.text]));
    expect(resolvePaymentTerm(byName.get("COD")).kind).toBe("COD");
    expect(resolvePaymentTerm(byName.get("50/50")).kind).toBe("FIFTY_FIFTY");
    expect(resolvePaymentTerm(byName.get("Net 30")).kind).toBe("NET30");
    expect(resolvePaymentTerm(byName.get("100% upfront")).kind).toBe("UPFRONT");
  });

  it("prints the settled COD wording for the COD preset — the stored text is just \"COD\"", () => {
    const cod = PAYMENT_TERM_PRESET_SEED.find((p) => p.name === "COD")!;
    expect(cod.text).toBe("COD");
    expect(quoteSoTermsPoint2(cod.text)).toBe(COD_POINT2_TEXT);
  });
});

describe("payment term preset schema", () => {
  it("fills the seed when an older settings snapshot has no presets", () => {
    const parsed = settingsSections.lists.parse({
      paymentTerms: ["COD"],
      contactRoles: ["Other"],
    });
    expect(parsed.paymentTermPresets).toEqual(PAYMENT_TERM_PRESET_SEED);
  });

  it("rejects duplicate names, even with different casing", () => {
    const rows = [
      { name: "Net 30", text: "Net 30", active: true },
      { name: "net 30", text: "Net 30 days", active: true },
    ];
    expect(paymentTermPresetsSchema.safeParse(rows).success).toBe(false);
  });

  it("rejects a text longer than the document terms field allows (100)", () => {
    const rows = [{ name: "Long", text: "x".repeat(101), active: true }];
    expect(paymentTermPresetsSchema.safeParse(rows).success).toBe(false);
  });

  it("rejects a blank name or blank text", () => {
    expect(paymentTermPresetsSchema.safeParse([{ name: " ", text: "Net 30", active: true }]).success).toBe(false);
    expect(paymentTermPresetsSchema.safeParse([{ name: "Net 30", text: "", active: true }]).success).toBe(false);
  });

  it("allows an empty list (no presets offered)", () => {
    expect(paymentTermPresetsSchema.safeParse([]).success).toBe(true);
  });
});

describe("activePaymentTermPresets", () => {
  it("returns active presets only, in saved order", () => {
    const rows = [
      { name: "A", text: "A terms", active: true },
      { name: "B", text: "B terms", active: false },
      { name: "C", text: "C terms", active: true },
    ];
    expect(activePaymentTermPresets(rows).map((p) => p.name)).toEqual(["A", "C"]);
  });
});
