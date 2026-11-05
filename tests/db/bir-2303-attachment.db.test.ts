// Staged 2303 attach (New Customer upload → save) against MySQL 8
// (TEST_DATABASE_URL). Uploads go to a temporary UPLOAD_DIR.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { CompanyRuleError } from "@/lib/services/companies";
import { prepareUploads } from "@/lib/services/attachments";
import { attachStagedBusinessDocument, listBusinessDocuments } from "@/lib/services/business-documents";
import { makeCustomer, makeUser, tag } from "./fixtures";
import type { DocActor } from "@/lib/services/quotes";

const fixturePdf = () => {
  const bytes = new Uint8Array(readFileSync(path.join(process.cwd(), "tests", "fixtures", "2303-sample.pdf")));
  return { name: "BIR 2303.pdf", size: bytes.byteLength, bytes };
};

const fixturePng = () => {
  // PNG stored base64 (the GitHub push tool only takes text files).
  const bytes = new Uint8Array(Buffer.from(readFileSync(path.join(process.cwd(), "tests", "fixtures", "2303-sample.png.b64"), "utf8").replace(/\s/g, ""), "base64"));
  return { name: "2303-photo.png", size: bytes.byteLength, bytes };
};

describe.skipIf(!env.hasDb)("staged 2303 attach (MySQL)", () => {
  let admin: DocActor;
  let viewer: DocActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-uploads-"));
    [admin, viewer] = await Promise.all([makeUser("costs"), makeUser("viewer")]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("attaches a staged PDF as the customer's BIR 2303", async () => {
    const customer = await makeCustomer();
    const upload = (await prepareUploads([fixturePdf()]))[0]!;
    const created = await attachStagedBusinessDocument({ kind: "customer", id: customer.id }, upload.storageKey, upload.fileName, admin);
    expect(created.type).toBe("BIR_2303");
    expect(created.customerId).toBe(customer.id);
    expect(created.fileName).toBe("BIR 2303.pdf");
    expect(created.mimeType).toBe("application/pdf");
    expect(created.storageKey).toBe(upload.storageKey);
    expect(created.sha256).toBe(upload.sha256);
    const docs = await listBusinessDocuments({ kind: "customer", id: customer.id });
    expect(docs.map((d) => d.id)).toContain(created.id);
    const audit = await db.auditLog.findFirst({ where: { entityType: "BusinessDocument", entityId: created.id, action: "create" } });
    expect(audit).not.toBeNull();
  });

  it("attaches a staged photo too", async () => {
    const customer = await makeCustomer();
    const upload = (await prepareUploads([fixturePng()]))[0]!;
    const created = await attachStagedBusinessDocument({ kind: "customer", id: customer.id }, upload.storageKey, upload.fileName, admin);
    expect(created.type).toBe("BIR_2303");
    expect(created.mimeType).toBe("image/png");
  });

  it("rejects a storage key that was never staged", async () => {
    const customer = await makeCustomer();
    await expect(attachStagedBusinessDocument({ kind: "customer", id: customer.id }, "c00000000000000000000000000000000", "BIR 2303.pdf", admin)).rejects.toThrow(CompanyRuleError);
  });

  it("rejects a file name that disagrees with the staged bytes", async () => {
    const customer = await makeCustomer();
    const upload = (await prepareUploads([fixturePng()]))[0]!;
    // The staged bytes are a PNG; claiming .pdf must fail re-validation.
    await expect(attachStagedBusinessDocument({ kind: "customer", id: customer.id }, upload.storageKey, "BIR 2303.pdf", admin)).rejects.toThrow(CompanyRuleError);
    expect(await db.businessDocument.findFirst({ where: { storageKey: upload.storageKey } })).toBeNull();
  });

  it("rejects a customer that doesn't exist", async () => {
    const upload = (await prepareUploads([fixturePdf()]))[0]!;
    await expect(attachStagedBusinessDocument({ kind: "customer", id: `no-such-${tag()}` }, upload.storageKey, upload.fileName, admin)).rejects.toThrow(CompanyRuleError);
  });

  it("refuses a viewer (no edit_data)", async () => {
    const customer = await makeCustomer();
    const upload = (await prepareUploads([fixturePdf()]))[0]!;
    await expect(attachStagedBusinessDocument({ kind: "customer", id: customer.id }, upload.storageKey, upload.fileName, viewer)).rejects.toThrow(ForbiddenError);
  });
});
