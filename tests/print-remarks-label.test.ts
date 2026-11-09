import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Jerwin 2026-11-09: the print's payment-term line was labelled
// "Terms & conditions:", which collided with the real TERMS AND
// CONDITIONS legal block printed below it. The line is now "Remarks:".
const src = readFileSync(
  join(process.cwd(), "src/components/docs/ProfessionalPrintDocument.tsx"),
  "utf8"
);

describe("print remarks label", () => {
  it("labels the terms line as Remarks", () => {
    expect(src).toContain('<span className="pp-label-inline">Remarks: </span>');
  });

  it("never labels a print line Terms & conditions", () => {
    expect(src).not.toContain("Terms &amp; conditions: ");
  });
});
