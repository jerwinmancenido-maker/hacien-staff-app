// Phone print columns: Description takes width from Qty and Unit.
// The Amount column stays wide enough that ₱520,000.00 does not clip.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function ruleWidth(selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(at, at + 240);
  const width = body.match(/width:\s*([^;]+);/);
  const value = width?.[1];
  if (!value) throw new Error(`no width for ${selector}`);
  return value.trim();
}

describe("phone print columns", () => {
  it("gives Description the space from Qty and Unit, and keeps Amount wide enough", () => {
    const qty = ruleWidth(".pp-items .pp-qty");
    const unit = ruleWidth(".pp-items .pp-unit");
    const amount = ruleWidth(".pp-items td.num:last-child");
    expect(qty).toBe("1.7rem");
    expect(unit).toBe("1.8rem");
    // 5.6rem fits ₱520,000.00 at 7.5pt with the cell padding. Do not shrink this.
    expect(amount).toBe("5.6rem");
    expect(Number.parseFloat(qty)).toBeLessThan(Number.parseFloat(amount));
    expect(Number.parseFloat(unit)).toBeLessThan(Number.parseFloat(amount));
    expect(css).toMatch(/\.pp-items \.num,\s*\.pp-totals \.num\s*\{[^}]*white-space:\s*nowrap/);
  });
});
