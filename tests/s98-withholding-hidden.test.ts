import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withholdingPickBoxesHidden } from "@/lib/quotes/withholding-defaults";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-98 withholding boxes stay hidden for NONE (No withholding) customers", () => {
  it("hides the boxes for NONE only — government and top agents keep them", () => {
    expect(withholdingPickBoxesHidden("NONE")).toBe(true);
    expect(withholdingPickBoxesHidden("GOVERNMENT")).toBe(false);
    expect(withholdingPickBoxesHidden("TOP_WITHHOLDING_AGENT")).toBe(false);
    expect(withholdingPickBoxesHidden(null)).toBe(false);
    expect(withholdingPickBoxesHidden(undefined)).toBe(false);
  });

  it("the quote editor gates the withholding tab's boxes for NONE customers", () => {
    const editor = src("src/components/docs/QuoteEditor.tsx");
    expect(editor).toContain("withholdingPickBoxesHidden(customer?.withholdingType)");
    // The picker lives on its own tab now (2026-11-07 UI plan); for NONE
    // customers the panel shows a note instead of the boxes.
    expect(editor).toContain("{withholdingPickBoxesHidden(customer?.withholdingType) ? (");
    // NONE displays as "No withholding" — the same customer the row names.
    expect(editor).toContain('if (type === "NONE") return "No withholding"');
  });
});
