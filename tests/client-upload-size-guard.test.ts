import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientUploadSizeError } from "@/lib/business-docs/sniff";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("client-side upload size guard", () => {
  it("rejects oversize files with the BusinessDocuments message", () => {
    const mb = 10;
    const limit = mb * 1024 * 1024;
    expect(clientUploadSizeError([{ size: limit }], mb)).toBeNull();
    expect(clientUploadSizeError([{ size: limit + 1 }], mb)).toBe(`The file is too big. The limit is ${mb} MB.`);
  });

  it.each([
    "src/components/AttachmentUploadForm.tsx",
    "src/components/cash/ExpenseForm.tsx",
    "src/app/(app)/settings/PrintCompanyForm.tsx",
    "src/components/BusinessDocuments.tsx",
  ])("%s wires clientUploadSizeError and disables submit while oversized", (path) => {
    const code = src(path);
    expect(code).toContain("clientUploadSizeError");
    expect(code).toContain("onFilesChange");
    expect(code).toMatch(/disabled=\{pending \|\| !!fileError\}/);
  });
});
