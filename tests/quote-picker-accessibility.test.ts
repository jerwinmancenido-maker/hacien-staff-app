import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Finding 1044 (Review Board run 66, Minor, accessibility): the quote
// editor's catalog pickers rendered a listbox a screen reader could not
// connect to its input — the description box had no combobox wiring (no
// aria-expanded / aria-controls / aria-activedescendant), and the
// lot-component pickers' option buttons had no role="option" at all, so
// the popup's existence and active option were never announced. The fix
// wires EVERY picker instance in QuoteEditor consistently: the line
// picker (one shared render, desktop + mobile layouts) and both
// lot-component pickers. Keyboard/mouse flow is untouched — this is
// semantics only. Source-level guards (the editor is a client
// component); live DOM behaviour was probed on the review server.
const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
const count = (needle: string) => editor.split(needle).length - 1;
const pickerBox = editor.slice(editor.indexOf("function pickerBox"), editor.indexOf("function productMeta"));
const descTextarea = editor.slice(editor.indexOf("function DescTextarea"), editor.indexOf("function customerTypeLabel"));

describe("line description box is a combobox when it drives the catalog picker", () => {
  it("DescTextarea renders the combobox wiring from its combo prop", () => {
    expect(descTextarea).toContain('role: "combobox" as const');
    expect(descTextarea).toContain('"aria-expanded": combo.expanded');
    expect(descTextarea).toContain('"aria-controls": combo.controls');
    expect(descTextarea).toContain('"aria-activedescendant": combo.activeDescendant');
    expect(descTextarea).toContain('"aria-autocomplete": "list" as const');
  });

  it("both line layouts pass the wiring, gated to picker-eligible lines", () => {
    // onDescription never opens the picker for a linked or lot line, so
    // those boxes keep plain-textarea semantics — no phantom combobox.
    expect(count("expanded: pickerFor === i.key")).toBe(2);
    expect(editor).toContain("controls: `picker-listbox-${i.key}`");
    expect(editor).toContain("controls: `m-picker-listbox-${i.key}`");
    expect(editor).toContain("`picker-opt-${i.key}-${(pickerResults[pickerActive] ?? pickerResults[0])!.id}`");
    expect(editor).toContain("`m-picker-opt-${i.key}-${(pickerResults[pickerActive] ?? pickerResults[0])!.id}`");
  });

  it("the line listbox and its options carry the ids the input points at", () => {
    expect(pickerBox).toContain("id={`picker-listbox-${idPrefix}${line.key}`}");
    expect(pickerBox).toContain("id={`picker-opt-${idPrefix}${line.key}-${r.id}`}");
    expect(pickerBox).toContain('role="option"');
    expect(pickerBox).toContain("aria-selected={ix === pickerActive}");
  });
});

describe("lot-component pickers carry the same semantics (class-first: all instances)", () => {
  it("both component description boxes are comboboxes controlling their own listbox", () => {
    expect(count('role="combobox"')).toBe(2);
    expect(editor).toContain("aria-controls={`comp-listbox-${c.key}`}");
    expect(editor).toContain("aria-controls={`m-comp-listbox-${c.key}`}");
    expect(count("aria-activedescendant={compPicker && compPicker.lineKey === i.key")).toBe(2);
  });

  it("both component listboxes have ids and every option is a real option", () => {
    expect(editor).toContain("id={`comp-listbox-${c.key}`}");
    expect(editor).toContain("id={`m-comp-listbox-${c.key}`}");
    expect(editor).toContain("id={`comp-opt-${c.key}-${r.id}`}");
    expect(editor).toContain("id={`m-comp-opt-${c.key}-${r.id}`}");
    // Line picker (1) + both component pickers (2): no bare option buttons left.
    expect(count('role="option"')).toBe(3);
    expect(count("aria-selected={ix === Math.min(compPicker.active, compPicker.results.length - 1)}")).toBe(2);
  });

  it("the component picker tracks an active option for the announcement", () => {
    // Highlight index: starts at the first match (mirrors the line
    // picker), follows the mouse, clamps when results shrink. It drives
    // aria-selected / aria-activedescendant and, since finding 1119,
    // also the visible is-active highlight and the shared keyboard
    // commit (pickerKeyIntent) -- the index the user sees highlighted
    // is the one Enter commits.
    expect(editor).toContain("active: number");
    expect(count("onMouseEnter={() => setCompPicker((p) => (p && p.compKey === c.key ? { ...p, active: ix } : p))}")).toBe(2);
  });
});
