import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-82: after browser Back on a new quote, the form looked filled (values
// the browser restored into the DOM) but Save stayed greyed out with
// 'Pick a customer' because React state was fresh and empty. Fix: clear
// the restored values on mount for a new quote, so what you see matches
// the state. Edit pages are untouched — clearing there would hide saved
// data instead of fixing a mismatch.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-82 new-quote Back state", () => {
  it("a new quote editor resets browser-restored form values on mount", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    expect(src).toContain("formRef.current?.reset()");
    const idx = src.indexOf("formRef.current?.reset()");
    expect(src.slice(Math.max(0, idx - 300), idx)).toContain("isNew");
  });
});
