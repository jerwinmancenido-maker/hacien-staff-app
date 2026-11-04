import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const css = () => readFileSync(join(root, "src/app/globals.css"), "utf8");

describe("S-97 2307-received print at phone width", () => {
  it("customer column wraps long words instead of spilling into TIN, and the header fits", () => {
    const full = css();
    const thBody = full.split("th.col-customer {")[1]?.split("}")[0] ?? "";
    expect(thBody).toContain("font-size: 8pt");
    expect(thBody).toContain("overflow-wrap: anywhere");
    const tdBody = full.split("td.col-customer {")[1]?.split("}")[0] ?? "";
    expect(tdBody).toContain("width: 3.5rem");
    expect(tdBody).toContain("overflow-wrap: anywhere");
    // The rule lives inside the narrow (phone-width) media block, not the base widths.
    const narrowStart = full.lastIndexOf("@media (max-width: 640px)", full.indexOf("th.col-customer {"));
    expect(narrowStart).toBeGreaterThan(-1);
  });
});
