import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-81: the Sales Orders list had two filter chips both called 'Open'
// that showed different results — the open=1 chip (OPEN orders with money
// still to bill) and the plain OPEN status chip. Renamed, not merged, so
// both filters keep their behaviour.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-81 SO list Open chips", () => {
  it("the unbilled-open chip no longer says just Open", () => {
    const src = read("src/app/(app)/sales-orders/page.tsx");
    expect(src).toContain('open: "1"');
    expect(src).toContain("Still to bill");
    // Only one chip may carry the bare label Open: the status chip.
    const openChips = src.match(/>\s*Open\s*</g) ?? [];
    expect(openChips).toHaveLength(0);
  });

  it("the plain OPEN status chip still exists via the status list", () => {
    const src = read("src/app/(app)/sales-orders/page.tsx");
    expect(src).toContain("SALES_ORDER_STATUSES.map");
    expect(src).toContain("SO_STATUS_LABELS[t]");
  });
});
