// Guard: the Quote details card carries NO withholding row (owner call
// 2026-11-08 — withholding lives only in its tab). The picker, the tab's
// error dot and the in-tab error all stay, so a bad pick is still visible.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/docs/QuoteEditor.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

describe("quote editor: withholding only in its tab", () => {
  it("has no withholding summary row in the details card", () => {
    expect(src).not.toContain("wh-collapsed-row");
    expect(src).not.toContain('<span className="label">Withholding</span>');
    expect(css).not.toContain(".wh-collapsed-row");
  });

  it("keeps the picker on the Withholding tab", () => {
    expect(src).toContain('{tab === "withholding" && (');
    expect(src).toContain("<WithholdingPickField");
    expect(src).toContain('onClick={() => setTab("withholding")}');
  });

  it("keeps pick errors visible via the tab dot and the in-tab error", () => {
    expect(src).toContain('e.withholdingCodes || e.withholding ? <span className="quote-tab-dot"');
    expect(src).toContain("error={e.withholdingCodes ?? e.withholding}");
  });
});
