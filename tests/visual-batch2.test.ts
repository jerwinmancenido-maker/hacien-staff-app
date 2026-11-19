// Visual batch 2 (final-check F16, Mac Block 1): the hand-rolled billing
// and Books tables join the F6 no-wrap protection, the billings table
// fits its card at 1280px, dark-mode surfaces follow the token flip, and
// phone widths stop stretching the settings page / print preview.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("F16 list tables join the no-wrap protection", () => {
  it("collections tags number/date/method/status cells", () => {
    const page = read("src/app/(app)/billing/collections/page.tsx");
    for (const key of ["number", "date", "method", "status"]) {
      expect(page).toContain(`data-col="${key}"`);
    }
  });

  it("2307s tags refs, status, received date and the action cell", () => {
    const page = read("src/app/(app)/billing/2307/page.tsx");
    for (const key of ["number", "date", "status", "action"]) {
      expect(page).toContain(`data-col="${key}"`);
    }
  });

  it("books registers tag date and document number cells", () => {
    const table = read("src/components/books/BooksRegisterTable.tsx");
    expect(table).toContain('data-col="number"');
    expect(table).toContain('data-col={c.key === "date" ? "date" : undefined}');
  });

  it("billings stacks the internal number under the booklet number", () => {
    const page = read("src/app/(app)/billing/billings/page.tsx");
    expect(page).not.toContain("<th>Internal</th>");
    expect(page).toContain('<div className="small faint">{r.number}</div>');
    expect(page).toContain('data-col="status"');
  });
});

describe("F16 audit log fits the settings column", () => {
  it("DataTable accepts a wrap class and the audit log removes the 640px floor", () => {
    expect(read("src/components/DataTable.tsx")).toContain("wrapClassName");
    expect(read("src/app/(app)/settings/AuditLogTab.tsx")).toContain('wrapClassName="audit-log-table"');
    expect(css).toMatch(/\.table-wrap\.audit-log-table table\.list \{\s*min-width: 0;/);
  });
});

describe("F16 page header never clips its actions", () => {
  it("the header wraps and the title block can shrink", () => {
    const start = css.indexOf(".page-header {");
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("flex-wrap: wrap");
    expect(css).toMatch(/\.page-header > div:first-child \{\s*min-width: 0;/);
    expect(css).toMatch(/\.page-header \.actions \{[^}]*flex-wrap: wrap;/s);
  });
});

describe("F16 dark mode follows the token flip", () => {
  it("settings nav, edit topbar and home cards use flipping tokens, not #fff", () => {
    const nav = css.slice(css.indexOf(".settings-nav {"), css.indexOf("}", css.indexOf(".settings-nav {")));
    expect(nav).toContain("background: var(--white)");
    const top = css.slice(css.indexOf(".edit-topbar {"), css.indexOf("}", css.indexOf(".edit-topbar {")));
    expect(top).toContain("background: var(--white)");
    expect(css).toMatch(/\.home-dashboard \.card \{\s*background: var\(--card\);/);
  });

  it("the withholding internal panel uses defined tokens", () => {
    expect(css).not.toContain("var(--bg-muted");
    expect(css).toMatch(/\.wh-internal-panel \{[^}]*background: var\(--fill\);/);
    expect(css).toMatch(/\.wh-internal-panel-label \{[^}]*color: var\(--text-2\);/);
  });

  it("the Home income-tax card header uses tokens, not inline white", () => {
    const card = read("src/components/home/IncomeTaxFilingsCard.tsx");
    expect(card).not.toContain('"#ffffff"');
    expect(card).toContain('backgroundColor: "var(--card)"');
  });

  it("dark tiles stay dark and blue chips stay readable in dark mode", () => {
    expect(css).toMatch(/\.chip\.dark \{\s*background: #0a0a0a;/);
    expect(css).toMatch(/\.avatar\.dark \{\s*background: #0a0a0a;/);
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(dark).toContain("--blue-dark: #9db9f5;");
  });

  it("the sidebar logo swaps to a light variant on screen in dark mode", () => {
    expect(css).toContain('content: url("/brand/logo-wordmark-dark.svg")');
    expect(css).toContain('content: url("/brand/logo-full-dark.svg")');
    expect(existsSync(new URL("../public/brand/logo-wordmark-dark.svg", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../public/brand/logo-full-dark.svg", import.meta.url))).toBe(true);
    const darkLogo = read("public/brand/logo-wordmark-dark.svg");
    expect(darkLogo).toContain("#E9EDF5");
    expect(darkLogo).toContain("#2563EB");
  });
});

describe("F16 phone widths", () => {
  it("the settings column can shrink and the tax calendar scrolls in its wrap", () => {
    const narrow = css.slice(css.lastIndexOf("@media (max-width: 768px)"));
    expect(narrow).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(narrow).toMatch(/\.tax-cal-settings-wrap \{\s*overflow-x: auto;/);
  });

  it("phone print preview gives the money columns real width", () => {
    const phone = css.slice(css.indexOf("Phone print preview: the wide sheet"));
    expect(phone).toMatch(/\.pp-items \.num \{\s*width: 8rem;/);
  });

  it("the items table trades padding for big-amount headroom", () => {
    expect(css).toMatch(/\.items-table table\.list th \{\s*white-space: normal;/);
  });
});
