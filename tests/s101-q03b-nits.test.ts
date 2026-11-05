import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readableDiffValue, diffArrayItems } from "@/components/DiffView";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-101 Q03b later-batch nits", () => {
  it("renders item diffs as plain readable lines, never raw JSON", () => {
    const items = [
      { description: "Widget A", qty: "2", unitPrice: "100.00" },
      { description: "Widget B", qty: "1", unitPrice: "250.00" },
    ];
    const out = readableDiffValue(items);
    expect(out).toBe(
      "Description: Widget A, Qty: 2, Unit price: 100.00; Description: Widget B, Qty: 1, Unit price: 250.00",
    );
    expect(out).not.toContain("{");
    expect(out).not.toContain('"');
    expect(readableDiffValue(null)).toBe("—");
    expect(readableDiffValue([])).toBe("—");
    expect(readableDiffValue({ status: "SENT" })).toBe("Status: SENT");
  });

  it("caps long item lists so the Activity feed stays readable", () => {
    const items = [
      { description: "Widget A", qty: "2" },
      { description: "Widget B", qty: "1" },
      { description: "Widget C", qty: "3" },
      { description: "Widget D", qty: "4" },
      { description: "Widget E", qty: "5" },
    ];
    const out = readableDiffValue(items);
    expect(out).toContain("Description: Widget A");
    expect(out).toContain("Description: Widget C");
    expect(out).not.toContain("Widget D");
    expect(out).toContain("… and 2 more");
  });

  it("diffs item lists by what changed, not the whole list twice", () => {
    const before = [
      { description: "Laptop 14in", qty: "3.00", unitPrice: "25500.50", total: "76501.50" },
      { description: "Installation service", qty: "1.00", unitPrice: "4999.25", total: "4999.25" },
    ];
    const after = [
      { description: "Laptop 14in", qty: "3.00", unitPrice: "25500.50", total: "76501.50" },
      { description: "Installation service", qty: "1.00", unitPrice: "5000.00", total: "5000.00" },
    ];
    const out = diffArrayItems(before, after);
    // The unchanged laptop line is skipped entirely.
    expect(out).not.toContain("Laptop 14in");
    expect(out).toContain("Installation service");
    expect(out).toContain("Unit price: 4999.25 → 5000.00");
    expect(out).toContain("Total: 4999.25 → 5000.00");
    // Identical lists show nothing; added/removed lines show in full.
    expect(diffArrayItems(before, before)).toBe("—");
    expect(diffArrayItems(before, [...before, { description: "Cable", qty: "1.00" }])).toContain("Added: Description: Cable");
    expect(diffArrayItems([...before, { description: "Cable", qty: "1.00" }], before)).toContain("Removed: Description: Cable");
  });

  it("the blank-cost approval case has the confirm-none reject check", () => {
    const dbTest = src("tests/db/quote-approvals.db.test.ts");
    const blankCase = dbTest.split("const blankId = await approvedQuote();")[1] ?? "";
    expect(blankCase).toContain("confirmNoneAndMarkQuoteSent(blankId, staff)");
    expect(blankCase).toContain("/waiting for approval/i");
  });
});
