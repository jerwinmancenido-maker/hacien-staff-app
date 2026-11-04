import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withholdingPickBoxesHidden } from "@/lib/quotes/withholding-defaults";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-98 withholding boxes stay hidden for NONE (Private) customers", () => {
  it("hides the boxes for NONE only — government and top agents keep them", () => {
    expect(withholdingPickBoxesHidden("NONE")).toBe(true);
    expect(withholdingPickBoxesHidden("GOVERNMENT")).toBe(false);
    expect(withholdingPickBoxesHidden("TOP_WITHHOLDING_AGENT")).toBe(false);
    expect(withholdingPickBoxesHidden(null)).toBe(false);
    expect(withholdingPickBoxesHidden(undefined)).toBe(false);
  });

  it("the quote editor gates both the Change button and the expanded boxes", () => {
    const editor = src("src/components/docs/QuoteEditor.tsx");
    expect(editor).toContain("withholdingPickBoxesHidden(customer?.withholdingType)");
    expect(editor).toContain("{whPickOpen && !withholdingPickBoxesHidden(customer?.withholdingType) ? (");
    // NONE displays as "Private" — the same customer the row names.
    expect(editor).toContain('if (type === "NONE") return "Private"');
  });
});
