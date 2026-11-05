import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Audit A: a closed sales order shows a blue "Closed" chip and appears in
// the list status filters, next to Open and Void.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("Audit A SO auto-close display", () => {
  it("CLOSED has a Closed label and a blue tone", () => {
    const src = read("src/components/docs/DocParts.tsx");
    expect(src).toContain('CLOSED: "Closed"');
    expect(src).toContain('CLOSED: "blue"');
  });

  it("CLOSED is in the list status filter", () => {
    const src = read("src/lib/quotes/views.ts");
    expect(src).toContain('"CLOSED"');
    expect(src).toMatch(/SALES_ORDER_STATUSES[^=]*=\s*\[[^\]]*"CLOSED"[^\]]*\]/);
  });
});
