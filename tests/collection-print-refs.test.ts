import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the collection print "Applied to" line (found in the 2026-11-08
// print review, Batch 15): billing numbers already carry their "BL-" prefix
// (e.g. "BL-2026-0001"), so the print view must not prepend another "BL " —
// the staging print rendered "BL BL-2026-0001 / booklet #1".
const views = readFileSync(join(process.cwd(), "src/lib/print/views.ts"), "utf8");

describe("collection print — Applied to references", () => {
  it("does not hard-code a BL prefix before the billing number", () => {
    expect(views).not.toContain("`BL ${a.billing.number}");
    expect(views).not.toContain('"BL " +');
  });

  it("still builds the reference from the billing number and booklet no.", () => {
    expect(views).toContain("${a.billing.number} / booklet #${a.billing.invoiceNo}");
  });
});
