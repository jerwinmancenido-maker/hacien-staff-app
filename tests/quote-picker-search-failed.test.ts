import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickerSearchOutcome } from "@/lib/items/picker-search";

// Picker hardening (Jerwin's go, 2026-11-10; REQ-PICKER-001): a failed
// catalog search must show "Search failed, try again." — never the
// "No product found" empty state, which made a live 500 indistinguishable
// from an empty catalog.

describe("pickerSearchOutcome", () => {
  it("passes items through on an ok response", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(pickerSearchOutcome(true, { ok: true, items })).toEqual({ items, failed: false });
  });

  it("an ok response with zero matches is NOT a failure", () => {
    expect(pickerSearchOutcome(true, { ok: true, items: [] })).toEqual({ items: [], failed: false });
  });

  it("an HTTP error is a failure even with a parseable body", () => {
    expect(pickerSearchOutcome(false, { ok: false, message: "boom" })).toEqual({ items: [], failed: true });
  });

  it("an ok:false body on HTTP 200 is a failure", () => {
    expect(pickerSearchOutcome(true, { ok: false, items: [] })).toEqual({ items: [], failed: true });
  });

  it("an unparseable body (null) is a failure", () => {
    expect(pickerSearchOutcome(true, null)).toEqual({ items: [], failed: true });
  });

  it("a body without an items array is a failure", () => {
    expect(pickerSearchOutcome(true, { ok: true })).toEqual({ items: [], failed: true });
    expect(pickerSearchOutcome(true, { ok: true, items: "nope" })).toEqual({ items: [], failed: true });
  });
});

const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
const pickerBox = editor.slice(editor.indexOf("function pickerBox"), editor.indexOf("function productMeta"));

describe("quote editor picker wires the failed state", () => {
  it("renders the exact failure copy before the empty state", () => {
    const failedAt = pickerBox.indexOf("Search failed, try again.");
    const emptyAt = pickerBox.indexOf("No product found for");
    expect(failedAt).toBeGreaterThanOrEqual(0);
    expect(emptyAt).toBeGreaterThan(failedAt);
    expect(pickerBox).toContain("pickerFailed ?");
  });

  it("the search effect routes through pickerSearchOutcome and flags throws", () => {
    expect(editor).toContain("pickerSearchOutcome<CatalogSearchResult>(res.ok, body)");
    expect(editor).toContain("setPickerFailed(outcome.failed)");
    expect(editor).toContain("setPickerFailed(true)");
  });
});
