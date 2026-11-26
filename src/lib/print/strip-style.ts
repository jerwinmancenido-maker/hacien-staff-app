/**
 * Print redesign v10 (owner-approved 2026-11-09): the running identity
 * strip no longer prints in the document flow — a table <thead> repeats
 * identically on every page, so the title + number printed twice on
 * page 1 (strip + title block) and the footer contact line repeated the
 * letterhead. The strip now lives in the @page top margin box of the
 * named "pp-doc" page (see globals.css), whose content differs per
 * document, so each print document emits this <style> with its own
 * title + number baked in. The :first rule must live in the SAME style
 * element, after the strip rule — a later plain @page rule otherwise
 * re-introduces the box on page 1 (verified in headless Chrome spikes,
 * 2026-11-09).
 */

/** Escape a string for use inside a CSS `content: "…"` value. */
export function cssContentString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s*\n\s*/g, " ")}"`;
}

/**
 * Company Profile slice 2 (census F1): the @page margin-box FOOTER
 * identity — the bottom-left contact line and the top-left short-name
 * mark of the pp-doc pages. Until this slice both were literals in
 * globals.css, so a Settings rename never reached the page footer. Each
 * print document now emits them from its pinned Settings snapshot (see
 * printFooterIdentity in lib/print/company.ts). The :first suppressions
 * live in the SAME style element, after the base rules, for the same
 * reason as the strip rules below. Font/size/color stay in globals.css —
 * only the identity content moves.
 */
export function printFooterCss(line: string, mark: string): string {
  const boxes = (page: string) =>
    `@page ${page} { @top-left { content: ${cssContentString(mark)}; } ` +
    `@bottom-left { content: ${cssContentString(line)}; } }\n` +
    `@page ${page}:first { @top-left { content: none; } @bottom-left { content: none; } }`;
  return boxes("pp-doc") + "\n" + boxes("pp-doc-letter");
}

/**
 * The generic @page twin for the book/tax prints, which run on the
 * unnamed page and its Letter variant: only the bottom-left footer line
 * (those pages carry no top-left mark in globals.css).
 */
export function printGenericFooterCss(line: string): string {
  return (
    `@page { @bottom-left { content: ${cssContentString(line)}; } }\n` +
    `@page letter { @bottom-left { content: ${cssContentString(line)}; } }`
  );
}

/**
 * The @page rules a print document emits for its margin-box strip.
 * `stripText` is the already-composed identity line (e.g.
 * "QUOTATION · QT-2026-0019"); it prints on page 2+ only.
 */
export function printStripCss(stripText: string): string {
  // F25: the strip must land on BOTH named pages — a document whose
  // paper setting is Letter prints under pp-doc-letter, and without
  // its own strip rule its page 2+ would lose the identity strip.
  return (
    `@page pp-doc { @top-right { content: ${cssContentString(stripText)}; ` +
    `font-size: 7.5pt; letter-spacing: 0.09em; color: #737373; } }\n` +
    `@page pp-doc:first { @top-right { content: none; } }\n` +
    `@page pp-doc-letter { @top-right { content: ${cssContentString(stripText)}; ` +
    `font-size: 7.5pt; letter-spacing: 0.09em; color: #737373; } }\n` +
    `@page pp-doc-letter:first { @top-right { content: none; } }`
  );
}
