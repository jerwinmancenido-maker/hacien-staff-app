// SearchPicker keyboard + re-pick behaviour (CTO fixes 2026-11-09, #170):
// pressing Enter right after opening the panel used to pick the empty
// "None" row and wipe the field, and re-picking the record already picked
// fired the editor's change handler (resetting the quote's contact,
// delivery pick and terms). These tests pin the REAL row/highlight logic
// the component runs (pickerRows / pickerActiveIndex are imported from
// the component, not copied) plus the wiring that uses them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickerActiveIndex, pickerRows, type SearchPickerOption } from "@/components/SearchPicker";

const options: SearchPickerOption[] = [
  { id: "sup-a", label: "Gilmore Street Seller" },
  { id: "sup-b", label: "Metro IT Parts" },
  { id: "sup-c", label: "UNO Computer Supply" },
];

describe("picker rows and the Enter target", () => {
  it("the empty row leads, then all options", () => {
    expect(pickerRows(options, "—", "").map((r) => r.id)).toEqual(["", "sup-a", "sup-b", "sup-c"]);
  });

  it("opening with a pick highlights the PICKED row, not None — Enter keeps it", () => {
    const rows = pickerRows(options, "—", "");
    const ix = pickerActiveIndex(rows, "sup-b");
    expect(ix).toBe(2);
    expect(rows[ix]?.id).toBe("sup-b");
  });

  it("with nothing picked, the highlight starts on None as before", () => {
    expect(pickerActiveIndex(pickerRows(options, "—", ""), "")).toBe(0);
  });

  it("typing keeps the highlight on the pick while it still matches", () => {
    const rows = pickerRows(options, "—", "metro");
    expect(rows.map((r) => r.id)).toEqual(["sup-b"]);
    expect(pickerActiveIndex(rows, "sup-b")).toBe(0);
    expect(rows[pickerActiveIndex(rows, "sup-b")]?.id).toBe("sup-b");
  });

  it("when the filter hides the pick, Enter takes the first match instead", () => {
    const rows = pickerRows(options, "—", "uno");
    expect(rows[0]?.id).toBe("sup-c");
    expect(pickerActiveIndex(rows, "sup-a")).toBe(0);
  });

  it("pickers without an empty option highlight the pick directly", () => {
    const rows = pickerRows(options, undefined, "");
    expect(rows.map((r) => r.id)).toEqual(["sup-a", "sup-b", "sup-c"]);
    expect(pickerActiveIndex(rows, "sup-c")).toBe(2);
  });
});

describe("SearchPicker wiring (source pins)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/SearchPicker.tsx"), "utf8");

  it("opening and typing set the highlight through pickerActiveIndex", () => {
    expect(src).toContain('setActive(pickerActiveIndex(pickerRows(options, emptyOptionLabel, ""), value))');
    expect(src).toContain("setActive(pickerActiveIndex(pickerRows(options, emptyOptionLabel, next), value))");
  });

  it("re-picking the current row does not fire onPick", () => {
    const pickFn = src.slice(src.indexOf("function pick(row: Row)"));
    expect(pickFn.indexOf("row.id !== value")).toBeGreaterThan(-1);
    expect(pickFn.indexOf("row.id !== value")).toBeLessThan(pickFn.indexOf("onPick(row.id)"));
  });
});

describe("quote editor customer re-pick guard (source pin)", () => {
  const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");

  it("pickCustomer returns early when the picked id is already on the quote", () => {
    const fn = editor.slice(editor.indexOf("function pickCustomer"));
    expect(fn.indexOf("if (id === h.customerId) return;")).toBeGreaterThan(-1);
    expect(fn.indexOf("if (id === h.customerId) return;")).toBeLessThan(fn.indexOf("applyPickDefaults"));
  });
});

describe("the highlighted row stays visible (Bugbot PR #175)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/SearchPicker.tsx"), "utf8");

  it("scrolls the active row into view whenever the highlight moves", () => {
    expect(src).toContain("scrollIntoView({ block: \"nearest\" })");
    expect(src).toContain("[data-picker-ix=\"${active}\"]");
    expect(src).toContain("}, [active, open, rows.length]);");
  });

  it("marks each row with its index for the scroll lookup", () => {
    expect(src).toContain("data-picker-ix={ix}");
    expect(src).toContain("ref={listRef}");
  });
});

describe("picker matches meta as well as label (search by amount / date)", () => {
  const recordOptions: SearchPickerOption[] = [
    { id: "so-1", label: "SO-2026-0005 — TESDA", meta: "₱155,965.00 · Nov 10, 2026" },
    { id: "so-2", label: "SO-2026-0004 — ARTA", meta: "₱598,000.00 · Nov 11, 2026" },
  ];

  it("finds a record by an amount fragment in its meta", () => {
    expect(pickerRows(recordOptions, "No linked order", "598").map((r) => r.id)).toEqual(["so-2"]);
    expect(pickerRows(recordOptions, "No linked order", "155,965").map((r) => r.id)).toEqual(["so-1"]);
  });

  it("finds a record by a date fragment in its meta", () => {
    expect(pickerRows(recordOptions, "No linked order", "nov 10").map((r) => r.id)).toEqual(["so-1"]);
  });

  it("still finds records by name and number fragments in the label", () => {
    expect(pickerRows(recordOptions, "No linked order", "tesda").map((r) => r.id)).toEqual(["so-1"]);
    expect(pickerRows(recordOptions, "No linked order", "0004").map((r) => r.id)).toEqual(["so-2"]);
  });

  it("a query matching nothing yields no rows, not even the empty row", () => {
    expect(pickerRows(recordOptions, "No linked order", "zzz")).toEqual([]);
  });

  it("options without meta still filter on the label alone", () => {
    expect(pickerRows(options, "—", "metro").map((r) => r.id)).toEqual(["sup-b"]);
  });
});
