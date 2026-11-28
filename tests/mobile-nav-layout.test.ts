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

describe("skip link guard (run-87 F9-C, findings 1295/1302/1304)", () => {
  const frame = readFileSync(path.join(process.cwd(), "src/components/AppFrame.tsx"), "utf8");

  it("places the skip link before the shell chrome, targeting main", () => {
    const skip = frame.indexOf('className="skip-link"');
    expect(skip).toBeGreaterThan(-1);
    expect(frame).toMatch(/<a className="skip-link" href="#main-content">/);
    expect(skip).toBeLessThan(frame.indexOf("nav-backdrop"));
    expect(frame).toMatch(/<main className="content" id="main-content" tabIndex={-1}>/);
  });
});

describe("sidebar-hide guard (ERP adoption item 2)", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const frame = readFileSync(path.join(process.cwd(), "src/components/AppFrame.tsx"), "utf8");

  it("ships AppFrame with a desktop sidebar toggle wired to the hidden class", () => {
    expect(frame).toMatch(/sidebar-toggle/);
    expect(frame).toMatch(/sidebar-hidden/);
    expect(frame).toMatch(/aria-expanded/);
    expect(frame).toMatch(/onSidebarHiddenChange/);
  });

  it("hides the sidebar fully and widens content only above the phone breakpoint", () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*769px\)[\s\S]*\.frame\.sidebar-hidden\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/\.frame\.sidebar-hidden\s+\.sidebar\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.sidebar-toggle\s*\{[^}]*display:\s*none/);
  });
});
