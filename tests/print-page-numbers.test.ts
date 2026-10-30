import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Page X of Y CSS", () => {
  const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");

  it("uses @page margin boxes with counter(page) and counter(pages)", () => {
    expect(css).toContain("@bottom-right");
    expect(css).toContain('content: "Page " counter(page) " of " counter(pages)');
    expect(css).toContain("counter(pages)");
  });

  it("falls back to Page X via .pp-page-num when totals are unsupported", () => {
    expect(css).toContain(".pp-page-num::after");
    expect(css).toContain('content: "Page " counter(page)');
  });
});
