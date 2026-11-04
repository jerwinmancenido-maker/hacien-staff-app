import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readableDiffValue } from "@/components/DiffView";

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

  it("the blank-cost approval case has the confirm-none reject check", () => {
    const dbTest = src("tests/db/quote-approvals.db.test.ts");
    const blankCase = dbTest.split("const blankId = await approvedQuote();")[1] ?? "";
    expect(blankCase).toContain("confirmNoneAndMarkQuoteSent(blankId, staff)");
    expect(blankCase).toContain("/waiting for approval/i");
  });
});
