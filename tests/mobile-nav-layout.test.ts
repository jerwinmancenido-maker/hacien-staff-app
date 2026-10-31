import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layout guard: every app page shares AppFrame's collapsed mobile drawer.
 * Fail if mobile CSS regresses to a stacked full sidebar above content.
 */
describe("mobile nav layout guard", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const frame = readFileSync(path.join(process.cwd(), "src/components/AppFrame.tsx"), "utf8");

  it("ships AppFrame with a menu toggle and nav-open class", () => {
    expect(frame).toMatch(/nav-toggle/);
    expect(frame).toMatch(/nav-open/);
    expect(frame).toMatch(/MenuIcon|CloseIcon/);
  });

  it("collapses the sidebar off-canvas at ≤768px until .nav-open", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.sidebar\s*\{[^}]*transform:\s*translateX\(-105%\)/);
    expect(css).toMatch(/\.frame\.nav-open\s+\.sidebar\s*\{[^}]*transform:\s*translateX\(0\)/);
    expect(css).toMatch(/\.nav-toggle\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.nav-toggle\s*\{[^}]*display:\s*inline-flex/);
  });
});
