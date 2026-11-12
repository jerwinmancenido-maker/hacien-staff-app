// Files attached to receiving reports (delivery receipts), supplier bills
// (invoice scans), sales orders (customer POs) and purchase orders (supplier
// quotes). Same storage and checks as business documents
// (src/lib/business-docs/*): magic-byte sniff, size limit, random storage key
// under UPLOAD_DIR. Files are written before the database transaction; if the
// transaction fails, discardUploads() removes them (no row points at them).

import { createHash } from "node:crypto";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { checkUpload, uploadMaxBytes } from "../business-docs/sniff";
import { discardUnreferencedFile, newStorageKey, saveFile } from "../business-docs/storage";
import { DocRuleError } from "../documents/common";
import { assertCanDeleteDocument, type PermissionUser } from "../permissions";

export type UploadFile = { name: string; size: number; bytes: Uint8Array };

export type PreparedUpload = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
  /** REQ-ATTACH-001: label for SO/PO files (src/lib/attachment-kinds.ts); unset elsewhere. */
  kind?: string | null;
};

export const MAX_ATTACHMENTS = 5;

/** Check every file first (nothing is written if one is bad), then save them. */
export async function prepareUploads(files: readonly UploadFile[]): Promise<PreparedUpload[]> {
  if (files.length > MAX_ATTACHMENTS) throw new DocRuleError(`Attach at most ${MAX_ATTACHMENTS} files.`, "files");
  const checked = files.map((f) => {
    const c = checkUpload(f, f.bytes.subarray(0, 16), uploadMaxBytes());
    if (!c.ok) throw new DocRuleError(`${f.name}: ${c.error}`, "files");
    if (f.bytes.byteLength !== f.size) throw new DocRuleError("The upload was incomplete. Try again.", "files");
    return { file: f, check: c };
  });
  const saved: PreparedUpload[] = [];
  try {
    for (const { file, check } of checked) {
      const storageKey = newStorageKey();
      await saveFile(storageKey, file.bytes);
      saved.push({
        fileName: check.fileName,
        mimeType: check.type.mime,
        sizeBytes: file.size,
        storageKey,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
      });
    }
  } catch (e) {
    await discardUploads(saved);
    throw e;
  }
  return saved;
}

export async function discardUploads(uploads: readonly PreparedUpload[]): Promise<void> {
  for (const u of uploads) await discardUnreferencedFile(u.storageKey);
}

export type AttachmentOwner =
  | { receivingReportId: string }
  | { supplierBillId: string }
  | { billingId: string }
  | { collectionId: string }
  | { withholding2307Id: string }
  | { supplierPaymentId: string }
  | { supplierWithholding2307Id: string }
  | { expenseId: string }
  | { deliveryId: string }
  | { spoiledBookletNumberId: string }
  | { taxCalendarCompletionId: string }
  | { quoteId: string }
  | { salesOrderId: string }
  | { purchaseOrderId: string };

/** Create the attachment rows (inside the document's transaction) with their audit rows. */
export async function createAttachments(tx: Tx, uploads: readonly PreparedUpload[], owner: AttachmentOwner, actorId: string) {
  for (const u of uploads) {
    const row = await tx.documentAttachment.create({ data: { ...u, ...owner, uploadedById: actorId } });
    await writeAudit(tx, {
      userId: actorId,
      entityType: "DocumentAttachment",
      entityId: row.id,
      action: "create",
      after: { fileName: row.fileName, sizeBytes: row.sizeBytes, ...owner },
    });
  }
}

/**
 * REQ-ATTACH-001: remove a file from its document — an ARCHIVE, never a
 * delete (no-delete rule): the row and the stored file stay for the record,
 * the file just stops showing on the document and in downloads lists.
 * Admin only (same gate as the S-104 document delete), with the audit row
 * in the same transaction as the archivedAt stamp.
 */
export async function archiveAttachment(id: string, actor: PermissionUser & { id: string }) {
  assertCanDeleteDocument(actor);
  return db.$transaction(async (tx) => {
    const att = await tx.documentAttachment.findUnique({ where: { id } });
    if (!att) throw new DocRuleError("Attachment not found.");
    if (att.archivedAt) throw new DocRuleError("That file was already removed.");
    const updated = await tx.documentAttachment.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "DocumentAttachment",
      entityId: att.id,
      action: "archive",
      before: { fileName: att.fileName, archivedAt: null },
      after: {
        fileName: att.fileName,
        kind: att.kind,
        salesOrderId: att.salesOrderId,
        purchaseOrderId: att.purchaseOrderId,
        archivedAt: updated.archivedAt?.toISOString() ?? null,
      },
    });
    return updated;
  });
}
