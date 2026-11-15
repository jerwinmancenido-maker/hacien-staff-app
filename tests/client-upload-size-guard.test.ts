import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientUploadSizeError, resetNativeFileInputAfterSizeReject } from "@/lib/business-docs/sniff";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const MB = 1024 * 1024;

describe("client-side upload size guard", () => {
  it("rejects oversize files with the BusinessDocuments message", () => {
    const mb = 10;
    expect(clientUploadSizeError([], mb)).toBeNull();
    expect(clientUploadSizeError([{ size: 10 * MB }], mb)).toBeNull();
    expect(clientUploadSizeError([{ size: 10 * MB + 1 }], mb)).toBe(`The file is too big. The limit is ${mb} MB.`);
    expect(clientUploadSizeError([{ size: 1 }, { size: 5 * MB + 1 }], 5)).toBe("The file is too big. The limit is 5 MB.");
  });

  it("clears the native input after a size reject so the same file can be picked again", () => {
    const input = { value: "C:\\fakepath\\huge.pdf" };
    const err = clientUploadSizeError([{ size: 11 * MB }], 10);
    expect(err).toBe("The file is too big. The limit is 10 MB.");

    // Label/error stay in React state; only the native value resets.
    resetNativeFileInputAfterSizeReject(input, err);
    expect(input.value).toBe("");

    // Empty value means the browser fires change when the same path is chosen again.
    input.value = "C:\\fakepath\\huge.pdf";
    expect(input.value).toBe("C:\\fakepath\\huge.pdf");

    // Valid pick: native value is kept for form submit.
    resetNativeFileInputAfterSizeReject(input, null);
    expect(input.value).toBe("C:\\fakepath\\huge.pdf");
  });

  it("FileInput clears the native value when onFilesChange returns a size error", () => {
    const f = src("src/components/FileInput.tsx");
    expect(f).toContain("resetNativeFileInputAfterSizeReject");
    expect(f).toContain("onFilesChange?.(next)");
  });

  it.each([
    "src/components/AttachmentUploadForm.tsx",
    "src/components/cash/ExpenseForm.tsx",
    "src/app/(app)/settings/PrintCompanyForm.tsx",
    "src/components/BusinessDocuments.tsx",
  ])("%s wires clientUploadSizeError, returns the error, and disables submit while oversized", (path) => {
    const code = src(path);
    expect(code).toContain("clientUploadSizeError");
    expect(code).toContain("onFilesChange");
    expect(code).toMatch(/return err/);
    expect(code).toMatch(/disabled=\{pending \|\| !!fileError\}/);
  });
});
