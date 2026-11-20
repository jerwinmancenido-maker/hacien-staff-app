import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickerSearchOutcome } from "@/lib/items/picker-search";

// Lot-component picker fix (Phase 2, scenario L1): the lot-component
// catalog search in the quote editor used to fail silently — any failed
// /api/items/search response (HTTP error, ok:false body, unparseable
// JSON, network throw) just cleared the results and showed nothing at
// all. It now routes through the same pickerSearchOutcome helper as the
// line picker, shows "Search failed, try again." with a Retry button,
// and a retry (or a new search) that succeeds clears the failed state.

const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
const compEffect = editor.slice(editor.indexOf("// Component catalog search"), editor.indexOf("Typing a description searches the catalog"));

describe("lot-component picker search outcome (L1)", () => {
  it("a forced error is a failure, not an empty result", () => {
    expect(pickerSearchOutcome(false, { ok: false, message: "boom" })).toEqual({ items: [], failed: true });
    expect(pickerSearchOutcome(true, null)).toEqual({ items: [], failed: true });
  });

  it("retry recovers: a later ok response passes items through with failed cleared", () => {
    const items = [{ id: "a" }];
    expect(pickerSearchOutcome(true, { ok: true, items })).toEqual({ items, failed: false });
  });

  it("an ok response with zero matches is NOT a failure (no error shown)", () => {
    expect(pickerSearchOutcome(true, { ok: true, items: [] })).toEqual({ items: [], failed: false });
  });
});

describe("quote editor lot-component picker wires the failed state", () => {
  it("the component effect routes through pickerSearchOutcome and flags throws", () => {
    expect(compEffect).toContain("pickerSearchOutcome<CatalogSearchResult>(res.ok, body)");
    expect(compEffect).toContain("failed: outcome.failed");
    expect(compEffect).toContain("results: [], failed: true");
  });

  it("the component effect re-runs on a retry (attempt is a dependency)", () => {
    expect(compEffect).toContain("compPicker?.attempt");
  });

  it("compPicker state carries failed + attempt", () => {
    expect(editor).toContain("failed: boolean; attempt: number");
  });

  it("both component blocks (desktop + mobile) show the failure copy with a retry", () => {
    // 1 line-picker occurrence + 2 lot-component occurrences.
    expect(editor.split("Search failed, try again.").length - 1).toBeGreaterThanOrEqual(3);
    expect(editor.split("Retry search").length - 1).toBeGreaterThanOrEqual(4); // 2 aria-labels + 2 labels per block set
    expect(editor.split("attempt: p.attempt + 1").length - 1).toBe(2);
    expect(editor.split("compPicker.failed || compPicker.results.length > 0").length - 1).toBe(2);
  });
});
