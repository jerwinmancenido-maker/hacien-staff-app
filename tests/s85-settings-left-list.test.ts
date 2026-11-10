// S-85: Settings page redesign — a left list of sections, each a clean card
// with short plain help text, the same 2-column field grid, and Save in the
// sticky top bar. Source tests (same pattern as S-66/S-71/S-84).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { desktopCss } from "./desktop-css";

const page = readFileSync("src/app/(app)/settings/page.tsx", "utf8");
const css = desktopCss(readFileSync("src/app/globals.css", "utf8"));
const form = (f: string) => readFileSync(`src/app/(app)/settings/${f}`, "utf8");

const SECTIONS = [
  "Company and letterhead",
  "Documents and numbering",
  "Quote terms",
  "Tax and BIR",
  "Invoice booklet",
  "Users and roles",
  "Audit log",
];

describe("S-85 settings left list", () => {
  it("lists the seven sections in a left nav, not top pill tabs", () => {
    for (const label of SECTIONS) expect(page).toContain(`label: "${label}"`);
    expect(page).toContain('className="settings-nav"');
    expect(page).toContain('className="settings-layout"');
    expect(page).not.toContain("PillTabs");
    expect(page).not.toContain("settings-pill-tabs");
  });

  it("keeps old ?tab= keys resolving to their section", () => {
    for (const [old, section] of [
      ["print", "company"],
      ["features", "company"],
      ["numbering", "documents"],
      ["approval", "quote-terms"],
      ["lists", "quote-terms"],
      ['"tax-calendar"', "tax"],
      ["withholding", "tax"],
      ["billing", "booklet"],
      ["changelog", "audit"],
    ]) {
      expect(page).toContain(`${old}: "${section}"`);
    }
  });

  it("shows a short plain help line per section", () => {
    expect(page).toContain("settings-section-intro");
    expect(page).toContain("Records are never deleted.");
  });

  it("lays the nav beside full-width content and stacks on narrow screens", () => {
    expect(css).toContain(".settings-layout {");
    expect(css).toContain("grid-template-columns: 220px minmax(0, 1fr);");
    expect(css).toContain(".settings-layout .settings-page {\n  max-width: none;");
    expect(css).toContain(".settings-nav {");
    expect(css).toContain("@media (max-width: 768px) {");
  });
});

describe("S-85 Save in the sticky top bar", () => {
  it.each(["SettingsForm.tsx", "NumberingForm.tsx", "PrintCompanyForm.tsx", "TaxCalendarForm.tsx", "UserForm.tsx", "WithholdingForm.tsx"])(
    "%s has Save in a top bar",
    (f) => {
      const src = form(f);
      expect(src).toContain('className="edit-topbar"');
      expect(src).toContain('type="submit"');
    },
  );

  it("forms other than Withholding no longer have a bottom Save bar", () => {
    for (const f of ["SettingsForm.tsx", "NumberingForm.tsx", "PrintCompanyForm.tsx", "TaxCalendarForm.tsx", "UserForm.tsx"]) {
      expect(form(f)).not.toContain("form-actions");
    }
  });

  it("Withholding keeps its bottom Add rate button; only Save moved up", () => {
    const src = form("WithholdingForm.tsx");
    expect(src).toContain("Add rate");
    expect(src).toContain('className="edit-topbar"');
  });

  it("the 2-column field grid is unchanged", () => {
    expect(form("SettingsForm.tsx")).toContain('className="form-grid"');
    expect(css).toContain(".settings-page .form-grid,");
  });
});
