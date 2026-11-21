import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Design guide v1.5 retoken (Errands REQ-HACIEN-DESIGN-DANGER-RETOKEN-001,
// cleared by Jerwin 2026-11-21): the destructive button's OUTLINE is the
// soft red #F08A8A in both themes, scoped to .btn-danger via its own
// token. The label text keeps the darker --red (the soft red on white
// fails normal contrast), and every other --red/--danger use (error
// text, alerts) keeps its current colour.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const occurrences = (needle: string) => css.split(needle).length - 1;

describe("destructive button retoken (design guide v1.5)", () => {
  it("defines the soft-red outline token in BOTH the light and dark roots", () => {
    expect(occurrences("--danger-outline: #f08a8a")).toBe(2);
  });

  it("scopes the soft outline to .btn-danger; the label keeps the darker red", () => {
    const start = css.indexOf(".btn-danger {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("border-color: var(--danger-outline)");
    expect(block).toContain("color: var(--red)");
    expect(block).not.toContain("border-color: var(--red)");
  });

  it("leaves the shared danger tokens untouched for error text and alerts", () => {
    expect(css).toContain("--danger: #b91c1c;");
    expect(css).toContain("--danger: #de8f8f;");
    expect(css).toContain("--red: var(--danger);");
  });
});
