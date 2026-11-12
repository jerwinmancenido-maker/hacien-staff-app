// UNSLOP foundations (approved by Jerwin 2026-11-11: light default, dark
// follows the computer setting; Soft radius scale) — structural pins on
// globals.css. The brace-balance guard runs separately.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

describe("UNSLOP foundations", () => {
  it("Soft radius scale is the token set", () => {
    expect(css).toContain("--radius-card: calc(16px");
    expect(css).toContain("--radius: calc(11px");
    expect(css).toContain("--radius-sm: calc(8px");
  });

  it("dark follows the computer setting via the token flip", () => {
    const at = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at);
    // Charcoal Variant A anchors from the approved mocks.
    expect(block).toContain("--bg: #0b0e14");
    expect(block).toContain("--white: #12161f");
    expect(block).toContain("--grey-200: #232b3b");
    // The accent never flips.
    expect(block).not.toContain("--blue:");
  });

  it("light stays the default (no dark values in the base :root)", () => {
    const base = css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(base).toContain("--ink: #0a0a0a");
    expect(base).not.toContain("#0b0e14");
  });
});
