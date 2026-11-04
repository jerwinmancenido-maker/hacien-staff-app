import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Staging visual-check fix (2026-11-05): the quote detail Actions menu
// listed "Edit" twice. The menu builder pushed the identical Edit item on
// two consecutive lines. There must be exactly one Edit entry.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("quote Actions menu Edit entry", () => {
  it("pushes the Edit menu item exactly once", () => {
    const src = read("src/components/docs/QuoteActions.tsx");
    // Scope to QuoteActions only: SalesOrderActions below has its own
    // legitimate Edit entry for sales orders.
    const quoteMenu = src.slice(
      src.indexOf("export function QuoteActions("),
      src.indexOf("export function SalesOrderActions("),
    );
    const matches = quoteMenu.match(/label: "Edit"/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
