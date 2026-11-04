import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-83: status labels used orange (amber). HACIEN palette is black, grey
// and blue; green/red only for good/bad. Neutral in-progress statuses
// move to a new blue chip tone. Genuine warnings (expiring documents,
// cost warnings, overdue) deliberately keep amber — they are warnings,
// not plain statuses.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-83 status label colors", () => {
  it("there is a blue chip tone in the brand blue", () => {
    expect(read("src/components/ui.tsx")).toContain('"blue"');
    const css = read("src/app/globals.css");
    expect(css).toContain(".chip.blue");
    expect(css).toContain("var(--blue-tint)");
  });

  it("document status maps no longer use amber for in-progress states", () => {
    expect(read("src/components/docs/DocParts.tsx")).toContain('SENT: "blue"');
    expect(read("src/components/billing/BillingParts.tsx")).toContain('OPEN: "blue"');
    expect(read("src/components/billing/BillingParts.tsx")).toContain('PARTIALLY_PAID: "blue"');
    expect(read("src/components/purchasing/PoParts.tsx")).toContain('SENT: "blue"');
    expect(read("src/components/purchasing/PoParts.tsx")).toContain('PARTIALLY_RECEIVED: "blue"');
    expect(read("src/components/payables/PayablesParts.tsx")).toContain('RECORDED: "blue"');
    expect(read("src/components/TransactionsTab.tsx")).toContain('SENT: "blue"');
  });

  it("good/bad tones are unchanged: green for done, red for bad", () => {
    const doc = read("src/components/docs/DocParts.tsx");
    expect(doc).toContain('WON: "green"');
    expect(doc).toContain('VOID: "red"');
    const billing = read("src/components/billing/BillingParts.tsx");
    expect(billing).toContain('PAID: "green"');
    expect(billing).toContain('VOID: "red"');
  });
});
