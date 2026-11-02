import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoIdUploadWarning, NO_ID_UPLOAD_WARNING } from "@/components/NoIdUploadWarning";
import { BUSINESS_DOC_TYPES } from "@/lib/business-docs/types";

describe("S-103: no ID copies, upload warning", () => {
  it("exports the exact warning constant text", () => {
    expect(NO_ID_UPLOAD_WARNING).toBe("Do not upload ID cards or copies of government IDs.");
  });

  it("renders the warning component with expected text and muted class", () => {
    const html = renderToStaticMarkup(createElement(NoIdUploadWarning));
    expect(html).toContain("Do not upload ID cards or copies of government IDs.");
    expect(html).toContain("muted");
    expect(html).toContain("small");
  });

  const FORM_FILES = [
    "src/components/BusinessDocuments.tsx",
    "src/components/cash/ExpenseForm.tsx",
    "src/components/payables/PaymentForm.tsx",
    "src/components/payables/Mark2307IssuedForm.tsx",
    "src/components/billing/BillingForm.tsx",
    "src/components/billing/Mark2307Form.tsx",
    "src/components/billing/CollectionForm.tsx",
    "src/components/purchasing/ReceiveForm.tsx",
    "src/components/purchasing/BillForm.tsx",
  ];

  it.each(FORM_FILES)("file %s includes NoIdUploadWarning", (relPath) => {
    const fullPath = path.resolve(process.cwd(), relPath);
    const content = readFileSync(fullPath, "utf8");
    expect(content).toContain("NoIdUploadWarning");
    expect(content).toMatch(/<NoIdUploadWarning\b/);
  });

  it("settings logo upload is not an attachment and does not have the warning", () => {
    const logoFile = path.resolve(process.cwd(), "src/app/(app)/settings/PrintCompanyForm.tsx");
    const content = readFileSync(logoFile, "utf8");
    expect(content).not.toContain("NoIdUploadWarning");
  });

  it("prisma/schema.prisma has no ID-type or ID-photo fields", () => {
    const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
    const schema = readFileSync(schemaPath, "utf8");

    // Must not have fields for ID photos/copies/government IDs
    const forbiddenFieldPatterns = [
      /\bidPhoto\b/i,
      /\bidCard\b/i,
      /\bidCopy\b/i,
      /\bidImage\b/i,
      /\bgovernmentId\b/i,
      /\bvalidId\b/i,
      /\bidAttachment\b/i,
    ];

    for (const pattern of forbiddenFieldPatterns) {
      expect(schema).not.toMatch(pattern);
    }

    // BusinessDocumentType enum has business docs only, no government ID types
    const forbiddenDocTypes = [
      "PASSPORT",
      "DRIVERS_LICENSE",
      "UMID",
      "SSS",
      "PHILID",
      "NATIONAL_ID",
      "PRC_ID",
      "POSTAL_ID",
      "VOTERS_ID",
    ];

    for (const docType of forbiddenDocTypes) {
      expect(schema).not.toContain(docType);
      expect((BUSINESS_DOC_TYPES as readonly string[])).not.toContain(docType);
    }
  });
});
