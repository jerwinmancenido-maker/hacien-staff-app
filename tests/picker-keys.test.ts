// Finding 1119 (Review Board run 79, Minor): the quote editor lot-
// component catalog picker had PR #289 ARIA wiring but no keyboard
// commit path -- options committed on click only and blur closed the
// panel in 150 ms, so a keyboard-only user could not link a component
// to a catalog product (run 79 J-03 step 6 fell back to free text).
// The fix is ONE shared keyboard-commit function (pickerKeyIntent in
// src/lib/picker-keys.ts) adopted by every custom picker in the app:
// the shared SearchPicker, the line-description catalog picker and the
// lot-component catalog picker. These tests pin the shared math against
// the real module (imported, not copied) plus the wiring that routes
// each picker through it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickerKeyIntent } from "@/lib/picker-keys";

describe("pickerKeyIntent -- the shared keyboard contract", () => {
  it("Escape closes, even with no options (a failed search must dismiss)", () => {
    expect(pickerKeyIntent("Escape", 3, 1)).toEqual({ kind: "close" });
    expect(pickerKeyIntent("Escape", 0, 0)).toEqual({ kind: "close" });
  });

  it("arrows move the highlight and wrap at both ends", () => {
    expect(pickerKeyIntent("ArrowDown", 3, 0)).toEqual({ kind: "highlight", index: 1 });
    expect(pickerKeyIntent("ArrowDown", 3, 2)).toEqual({ kind: "highlight", index: 0 });
    expect(pickerKeyIntent("ArrowUp", 3, 0)).toEqual({ kind: "highlight", index: 2 });
    expect(pickerKeyIntent("ArrowUp", 3, 2)).toEqual({ kind: "highlight", index: 1 });
  });

  it("Enter commits the highlighted option", () => {
    expect(pickerKeyIntent("Enter", 3, 2)).toEqual({ kind: "commit", index: 2 });
    expect(pickerKeyIntent("Enter", 1, 0)).toEqual({ kind: "commit", index: 0 });
  });

  it("an out-of-range highlight is clamped to the visible one before use", () => {
    expect(pickerKeyIntent("Enter", 2, 9)).toEqual({ kind: "commit", index: 1 });
    expect(pickerKeyIntent("ArrowDown", 2, 9)).toEqual({ kind: "highlight", index: 0 });
    expect(pickerKeyIntent("Enter", 2, -1)).toEqual({ kind: "commit", index: 0 });
  });

  it("with no options, navigation/commit keys keep their default behaviour", () => {
    expect(pickerKeyIntent("ArrowDown", 0, 0)).toBeNull();
    expect(pickerKeyIntent("ArrowUp", 0, 0)).toBeNull();
    expect(pickerKeyIntent("Enter", 0, 0)).toBeNull();
  });

  it("unrelated keys are not picker keys", () => {
    expect(pickerKeyIntent("a", 3, 0)).toBeNull();
    expect(pickerKeyIntent("Tab", 3, 0)).toBeNull();
    expect(pickerKeyIntent(" ", 3, 0)).toBeNull();
  });
});

describe("every custom picker routes through the shared function (source pins)", () => {
  const searchPicker = readFileSync(path.join(process.cwd(), "src/components/SearchPicker.tsx"), "utf8");
  const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  it("SearchPicker commits through pickerKeyIntent", () => {
    expect(searchPicker).toContain("pickerKeyIntent(ev.key, rows.length, active)");
  });

  it("the line-description picker commits through pickerKeyIntent", () => {
    expect(editor).toContain("pickerKeyIntent(ev.key, pickerResults.length, pickerActive)");
  });

  it("the lot-component picker has a key handler on BOTH layouts, sharing the same math", () => {
    expect(editor).toContain("function onCompKeyDown");
    expect(editor).toContain("pickerKeyIntent(ev.key, compPicker.results.length, compPicker.active)");
    expect(count(editor, "onKeyDown={(ev) => onCompKeyDown(i, c, ev)}")).toBe(2);
    expect(editor).toContain("applyComponentPick(line, comp, r)");
  });

  it("the component highlight the user sees is the one Enter commits (is-active on both layouts)", () => {
    expect(count(editor, "Math.min(compPicker.active, compPicker.results.length - 1) ? \" is-active\" : \"\"")).toBe(2);
  });
});
