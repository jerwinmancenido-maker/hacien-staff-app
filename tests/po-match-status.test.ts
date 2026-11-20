// F24 (final-check S109): the PO Match tab's STATUS cell must show the
// line status from threeWayMatch — which is NOT_BILLED when no live
// bills exist — not one chip per issue. After voiding the only bill
// the cell used to keep saying "Qty mismatch" (from the received <
// ordered issue) while the header said "Not billed yet". The status
// semantics themselves are pinned in tests/purchasing.test.ts.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("F24 PO match STATUS cell", () => {
  it("renders the line status, not the issue list", () => {
    const page = read("src/app/(app)/purchase-orders/[id]/page.tsx");
    expect(page).toContain("<MatchChip status={l.status} />");
    expect(page).not.toContain("l.issues.map");
  });
});
