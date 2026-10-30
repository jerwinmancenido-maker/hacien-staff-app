// Business documents (DTI, SEC, BIR 2303, permits …) attached to a customer or
// supplier. Upload/archive need edit_data; viewing and downloading need view.
// Replacing a document = upload a new one + archive the old (history stays).
// Never deleted. Every change (and every download) writes an audit row.

import type { BusinessDocumentType } from "@prisma/client";
import { createHash } from "node:crypto";
import { db } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { manilaToday } from "../format";
import { getSettingsSnapshot } from "../settings";
import { checkUpload, uploadMaxBytes } from "../business-docs/sniff";
import { expiringCutoff, expiryStatus } from "../business-docs/expiry";
import { discardUnreferencedFile, newStorageKey, saveFile } from "../business-docs/storage";
import type { BusinessDocumentMeta } from "../validation/business-documents";
import { CompanyRuleError } from "./companies";
import type { ContactOwner as Owner } from "./contacts";

export type DocOwner = Owner;
type Actor = PermissionUser & { id: string };

const ownerWhere = (o: DocOwner) => (o.kind === "customer" ? { customerId: o.id } : { supplierId: o.id });

export async function expiryWarningDays(): Promise<number> {
  return (await getSettingsSnapshot()).settings.documents.expiryWarningDays;
}

/** Newest first; archived (replaced) ones only when asked. */
export function listBusinessDocuments(owner: DocOwner, opts: { includeArchived?: boolean } = {}) {
  return db.businessDocument.findMany({
    where: { ...ownerWhere(owner), ...(opts.includeArchived ? {} : { archivedAt: null }) },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
  });
}

/** Expired / expiring counts among the owner's active documents (for the overview card). */
export async function documentExpiryCounts(owner: DocOwner, warnDays: number, today: Date = manilaToday()) {
  const docs = await db.businessDocument.findMany({
    where: { ...ownerWhere(owner), archivedAt: null, expiryDate: { not: null, lte: expiringCutoff(today, warnDays) } },
    select: { expiryDate: true },
  });
  const states = docs.map((d) => expiryStatus(d.expiryDate, today, warnDays).state);
  const active = await db.businessDocument.count({ where: { ...ownerWhere(owner), archivedAt: null } });
  return { active, expired: states.filter((s) => s === "expired").length, expiring: states.filter((s) => s === "expiring").length };
}

/** Customer or supplier ids with an active document that is expired or expires within the warning window. */
export async function ownersWithExpiringDocuments(kind: DocOwner["kind"], warnDays: number, today: Date = manilaToday()): Promise<string[]> {
  const rows = await db.businessDocument.findMany({
    where: {
      archivedAt: null,
      expiryDate: { not: null, lte: expiringCutoff(today, warnDays) },
      ...(kind === "customer" ? { customerId: { not: null } } : { supplierId: { not: null } }),
    },
    select: { customerId: true, supplierId: true },
    distinct: kind === "customer" ? ["customerId"] : ["supplierId"],
  });
  return rows.map((r) => (kind === "customer" ? r.customerId! : r.supplierId!));
}

export type UploadFile = { name: string; size: number; bytes: Uint8Array };

export async function uploadBusinessDocument(owner: DocOwner, meta: BusinessDocumentMeta, file: UploadFile, actor: Actor) {
  assertCan(actor, "edit_data");
  const check = checkUpload(file, file.bytes.subarray(0, 16), uploadMaxBytes());
  if (!check.ok) throw new CompanyRuleError(check.error, "file");
  if (file.bytes.byteLength !== file.size) throw new CompanyRuleError("The upload was incomplete. Try again.", "file");

  const ownerRow = owner.kind === "customer" ? await db.customer.findUnique({ where: { id: owner.id } }) : await db.supplier.findUnique({ where: { id: owner.id } });
  if (!ownerRow) throw new CompanyRuleError(`That ${owner.kind} doesn't exist.`);

  const storageKey = newStorageKey();
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  await saveFile(storageKey, file.bytes);
  try {
    return await db.$transaction(async (tx) => {
      if (meta.replacesId) {
        const old = await tx.businessDocument.findUnique({ where: { id: meta.replacesId } });
        const sameOwner = old && (owner.kind === "customer" ? old.customerId === owner.id : old.supplierId === owner.id);
        if (!old || !sameOwner) throw new CompanyRuleError("The document to replace wasn't found.");
        if (old.archivedAt) throw new CompanyRuleError("That document was already replaced or archived.");
      }
      const created = await tx.businessDocument.create({
        data: {
          ...ownerWhere(owner),
          type: meta.type as BusinessDocumentType,
          otherLabel: meta.type === "OTHER" ? meta.otherLabel : null,
          docNumber: meta.docNumber,
          issueDate: meta.issueDate,
          expiryDate: meta.expiryDate,
          fileName: check.fileName,
          mimeType: check.type.mime,
          sizeBytes: file.size,
          storageKey,
          sha256,
          replacesId: meta.replacesId,
          uploadedById: actor.id,
        },
      });
      await writeAudit(tx, { userId: actor.id, entityType: "BusinessDocument", entityId: created.id, action: "create", after: created });
      if (meta.replacesId) {
        const before = await tx.businessDocument.findUniqueOrThrow({ where: { id: meta.replacesId } });
        const after = await tx.businessDocument.update({ where: { id: before.id }, data: { archivedAt: new Date() } });
        await writeAudit(tx, { userId: actor.id, entityType: "BusinessDocument", entityId: before.id, action: "archive", before, after: { ...after, replacedBy: created.id } });
      }
      return created;
    });
  } catch (e) {
    // No row points at the file, so it isn't kept.
    await discardUnreferencedFile(storageKey);
    throw e;
  }
}

export async function setBusinessDocumentArchived(id: string, archived: boolean, actor: Actor) {
  assertCan(actor, "edit_data");
  return db.$transaction(async (tx) => {
    const before = await tx.businessDocument.findUniqueOrThrow({ where: { id } });
    if (!!before.archivedAt === archived) return before;
    const after = await tx.businessDocument.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await writeAudit(tx, { userId: actor.id, entityType: "BusinessDocument", entityId: id, action: archived ? "archive" : "restore", before, after });
    return after;
  });
}
