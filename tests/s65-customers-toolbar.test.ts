import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { desktopCss } from "./desktop-css";

// S-65: customers list toolbar — search, filter tabs and buttons were
// different heights and styles. Now: one row, one height (36px), one
// font size (13px), one border radius, in the shared toolbar styles.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-65 customers toolbar, one height and one style", () => {
  it("customers page keeps search, pill tabs and filter chips in one toolbar", () => {
    const src = read("src/app/(app)/customers/page.tsx");
    const toolbar = src.slice(src.indexOf('<div className="toolbar">'));
    expect(toolbar).toContain('className="search-pill"');
    expect(toolbar).toContain("<PillTabs");
    expect(toolbar).toContain('className={`filter-chip');
  });

  it("toolbar controls share height 36px and font size 13px", () => {
    const css = desktopCss(read("src/app/globals.css"));
    // Search box was already 36px; chips and tabs are brought to match it.
    expect(css).toContain(".search-pill {\n  display: flex;");
    expect(css).toMatch(/\.search-pill \{[^}]*height: 36px;/);
    expect(css).toMatch(/\.toolbar \.filter-chip \{[^}]*height: 36px;/);
    expect(css).toMatch(/\.toolbar \.filter-chip \{[^}]*font-size: 13px;/);
    expect(css).toMatch(/\.toolbar \.pill-tabs-track \{[^}]*height: 36px;/);
    expect(css).toMatch(/\.toolbar \.pill-tabs-track\.track-sm \.pill-tab \{[^}]*height: 30px;/);
    expect(css).toMatch(/\.toolbar \.pill-tabs-track\.track-sm \.pill-tab \{[^}]*min-height: 0;/);
  });

  it("toolbar tabs lose their 16px bottom margin (they sat lower than the rest)", () => {
    const css = desktopCss(read("src/app/globals.css"));
    expect(css).toMatch(/\.toolbar \.pill-tabs-wrap \{[^}]*margin-bottom: 0;/);
  });
});
