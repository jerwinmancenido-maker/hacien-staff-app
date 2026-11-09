import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phone view (screen ≤640px) is 65% of the desktop lengths.
 * Desktop and tablet keep scale 1. 1px hairlines are not scaled.
 */
describe("phone UI scale", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("defaults to scale 1 and drops to 0.65 only on a phone screen", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--ui-scale:\s*1;/);
    const phone = css.match(/@media screen and \(max-width:\s*640px\)\s*\{([\s\S]*?)\n\}/);
    expect(phone?.[1]).toMatch(/--ui-scale:\s*0\.65;/);
    expect(css).not.toMatch(/zoom\s*:/);
    expect(css).not.toMatch(/transform\s*:\s*scale\(/);
  });

  it("scales shared lengths with the variable and leaves 1px borders", () => {
    expect(css).toMatch(/html,\s*body\s*\{[^}]*font-size:\s*calc\(14px \* var\(--ui-scale, 1\)\);/);
    expect(css).toMatch(/\.btn\s*\{[^}]*height:\s*calc\(36px \* var\(--ui-scale, 1\)\);/);
    expect(css).toMatch(/\.table-wrap table\.list\s*\{[^}]*min-width:\s*calc\(640px \* var\(--ui-scale, 1\)\);/);
    expect(css).toMatch(/\.card\s*\{[^}]*border:\s*1px solid var\(--border\);/);
  });

  it("does not rewrite media-query breakpoints into the scale variable", () => {
    const preludes = css.match(/@media[^{]*\{/g) ?? [];
    for (const prelude of preludes) {
      expect(prelude).not.toContain("ui-scale");
      expect(prelude).not.toContain("calc(");
    }
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("@media (max-width: 768px)");
  });

  it("keeps phone tap targets and iOS field text at a fixed floor", () => {
    const phone = css.slice(css.indexOf("@media screen and (max-width: 640px)"));
    expect(phone).toMatch(/font-size:\s*16px !important;/);
    expect(phone).toMatch(/min-height:\s*32px;/);
    expect(phone).toMatch(/\.form-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(phone).toMatch(/\.page-header \.actions[^}]*flex-wrap:\s*wrap;/);
  });
});
