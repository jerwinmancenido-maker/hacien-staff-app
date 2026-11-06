import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-70: quote sign-off — Prepared by is picked from staff (defaults to the
// quote's creator; 2026-11-07 preparer picker), showing the chosen person's
// name + position and their uploaded signature image, Approved by from the
// S-18 approval (name + date and time), the "electronically generated,
// approved in HACIEN system" line, Conforme staying a blank line, and an
// uploaded signed conforme saved on the quote.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-70 quote sign-off", () => {
  it("editor sign-off shows prepared position/signature and approver + time", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    // Preparer picker (2026-11-07): the position/signature come from the
    // chosen staff user, not from fixed creator props.
    expect(src).toContain("staffUsers");
    expect(src).toContain("preparedById");
    expect(src).toContain("preparer?.position");
    expect(src).toContain("hasSignature");
    expect(src).toContain("/files/user-signature/");
    expect(src).toContain("approvedByName");
    expect(src).toContain("approvedAt");
    expect(src).toContain("Electronically generated, approved in the HACIEN system.");
  });

  it("user profile has a position field and a signature upload", () => {
    const form = read("src/app/(app)/settings/UserForm.tsx");
    expect(form).toContain('name="position"');
    expect(form).toContain('name="signature"');
    expect(form).toContain("/files/user-signature/");
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("position            String?   @db.VarChar(120)");
    expect(schema).toContain("signatureStorageKey String?");
    const service = read("src/lib/services/user-signature.ts");
    expect(service).toContain("sniffLogoMime");
  });

  it("quote print carries prepared position/signature, approver + time, and the generated line", () => {
    const views = read("src/lib/print/views.ts");
    expect(views).toContain("quoteSignatories(q, preparer)");
    expect(views).toContain("Electronically generated, approved in the HACIEN system.");
    const doc = read("src/components/docs/ProfessionalPrintDocument.tsx");
    expect(doc).toContain("s.signatureUrl");
    expect(doc).toContain("doc.generatedNote");
    const types = read("src/lib/print/types.ts");
    expect(types).toContain("signatureUrl?: string | null");
    expect(types).toContain("generatedNote?: string | null");
  });

  it("signed conforme uploads are saved on the quote and listed on its page", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("quoteId                   String?");
    const attachments = read("src/lib/services/attachments.ts");
    expect(attachments).toContain("| { quoteId: string }");
    const actions = read("src/app/(app)/quotes/actions.ts");
    expect(actions).toContain("uploadQuoteConformeAction");
    expect(actions).toContain("createAttachments(tx, uploads, { quoteId: id }");
    const page = read("src/app/(app)/quotes/[id]/page.tsx");
    expect(page).toContain("Signed conforme");
    expect(page).toContain("conformeFiles");
    const migration = read("prisma/migrations/20261104190000_s70_quote_signoff/migration.sql");
    expect(migration).toContain("ADD COLUMN `position`");
    expect(migration).toContain("ADD COLUMN `quoteId`");
  });
});
