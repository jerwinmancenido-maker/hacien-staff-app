import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the PR #182 rebase failure mode: an unclosed rule or media query
// earlier in globals.css silently swallows every block after it (the rules
// still "exist", so selector-presence checks pass while browsers drop them).
function braceDepths(css: string): { depthAt: (needle: string) => number; finalDepth: number; minDepth: number } {
  let depth = 0;
  let minDepth = 0;
  let state: "normal" | "comment" | "single" | "double" = "normal";
  const depthByNeedle = new Map<string, number>();
  const needles = [".create-pos .table-wrap {", ".alert.info {"];
  let lineStartDepth = 0;
  const lines = css.split("\n");
  for (const line of lines) {
    lineStartDepth = depth;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      const next = line[i + 1];
      if (state === "comment") {
        if (ch === "*" && next === "/") { state = "normal"; i++; }
        continue;
      }
      if (state === "single") { if (ch === "'") state = "normal"; continue; }
      if (state === "double") { if (ch === '"') state = "normal"; continue; }
      if (ch === "/" && next === "*") { state = "comment"; i++; continue; }
      if (ch === "'") { state = "single"; continue; }
      if (ch === '"') { state = "double"; continue; }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    minDepth = Math.min(minDepth, depth);
    for (const needle of needles) {
      if (line.includes(needle) && !depthByNeedle.has(needle)) depthByNeedle.set(needle, lineStartDepth);
    }
  }
  return { depthAt: (n) => depthByNeedle.get(n) ?? -1, finalDepth: depth, minDepth };
}

describe("globals.css brace structure", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const r = braceDepths(css);

  it("balances: depth never goes negative and returns to 0", () => {
    expect(r.minDepth).toBeGreaterThanOrEqual(0);
    expect(r.finalDepth).toBe(0);
  });

  it("keeps the Create POs block at the top level (not nested in an earlier rule)", () => {
    expect(r.depthAt(".create-pos .table-wrap {")).toBe(0);
    expect(r.depthAt(".alert.info {")).toBe(0);
  });
});
