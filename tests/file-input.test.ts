import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Styled file picker: the browser's native "Choose Files / No file chosen"
 * chrome matches nothing in the design system, so every upload in the app
 * goes through one shared component (app button + file names in app type)
 * while the real input stays in the DOM so form submission is unchanged.
 */
describe("styled file picker", () => {
  it("component opens the picker from an app button and shows names + Clear", () => {
    const f = src("src/components/FileInput.tsx");
    expect(f).toContain('className="btn btn-secondary"');
    expect(f).toContain("inputRef.current?.click()");
    expect(f).toContain('"No file chosen"');
    expect(f).toContain("files.map((f) => f.name).join");
    expect(f).toContain('className="btn-link"');
    expect(f).toContain("Clear");
    expect(f).toContain('className="file-input-hidden"');
    expect(f).toContain("onFilesChange");
  });

  it("no raw file input remains anywhere except the shared component", () => {
    const bad: string[] = [];
    for (const p of walk(join(root, "src"))) {
      if (p.endsWith("src/components/FileInput.tsx")) continue;
      if (readFileSync(p, "utf8").includes('type="file"')) bad.push(p);
    }
    expect(bad).toEqual([]);
  });

  it("usages keep their field name, accept list and required flag", () => {
    expect(src("src/components/billing/CollectionForm.tsx")).toContain(
      '<FileInput id="files" name="files" accept=".pdf,.png,.jpg,.jpeg" multiple />',
    );
    expect(src("src/components/billing/MarkSpoiledForm.tsx")).toContain("required");
    expect(src("src/components/BusinessDocuments.tsx")).toContain("onFilesChange");
    expect(src("src/components/payables/PaymentForm.tsx")).toContain(
      'name="files" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple',
    );
  });
});
