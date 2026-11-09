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
 * The @page rules a print document emits for its margin-box strip.
 * `stripText` is the already-composed identity line (e.g.
 * "QUOTATION · QT-2026-0019"); it prints on page 2+ only.
 */
export function printStripCss(stripText: string): string {
  return (
    `@page pp-doc { @top-right { content: ${cssContentString(stripText)}; ` +
    `font-size: 7.5pt; letter-spacing: 0.09em; color: #737373; } }\n` +
    `@page pp-doc:first { @top-right { content: none; } }`
  );
}
