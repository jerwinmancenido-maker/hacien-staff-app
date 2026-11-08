import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Owner call (Jerwin, 2026-11-08): a quote line can always be deleted. The
// old guard disabled the remove button on the only remaining line, so a
// wrong product could not be cleared. Now removing the last line swaps in
// a fresh blank line instead — the editor never sits at zero lines.
const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");

describe("quote line remove is never blocked", () => {
  it("no remove button is disabled for the last line", () => {
    expect(editor).not.toContain("disabled={items.length === 1}");
  });

  it("both line layouts route remove through removeItem", () => {
    const matches = editor.match(/onClick=\{\(\) => removeItem\(i\)\}/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("removing the only line replaces it with a blank line", () => {
    expect(editor).toContain("const removeItem");
    expect(editor).toContain("xs.length === 1 ? [blankItem(linePicks, allocLineKey())] : xs.filter((x) => x.key !== line.key)");
  });
});
