// Download of a receiving report / supplier bill attachment. Signed out → 401.
// RR files (delivery receipts) need "view"; bill files are cost data and also
// need "Can see costs". Unknown id or missing file → 404. Read by storage key only.

import { Readable } from "node:stream";
import { db } from "./db";
import { writeAudit } from "./audit";
import { can, canSeeCosts, type PermissionUser } from "./permissions";
import { openFile } from "./business-docs/storage";
import { contentDisposition } from "./business-docs/download";

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } as const;

function text(status: number, body: string) {
  return new Response(body, { status, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function attachmentDownload(user: (PermissionUser & { id: string }) | null, id: string, meta: { ip?: string | null } = {}): Promise<Response> {
  if (!user) return text(401, "Sign in to download this file.");
  if (!can(user, "view")) return text(403, "You don't have permission to download this file.");
  if (!/^[a-z0-9]{1,64}$/i.test(id)) return text(404, "Not found.");
  const att = await db.documentAttachment.findUnique({ where: { id } });
  if (!att) return text(404, "Not found.");
  if (att.supplierBillId && !canSeeCosts(user)) return text(403, "You don't have permission to download this file.");
  const file = await openFile(att.storageKey).catch(() => null);
  if (!file) return text(404, "The file is missing from storage.");
  await writeAudit(db, {
    userId: user.id,
    entityType: "DocumentAttachment",
    entityId: att.id,
    action: "download",
    after: { fileName: att.fileName, receivingReportId: att.receivingReportId, supplierBillId: att.supplierBillId },
    diff: false,
    ip: meta.ip ?? null,
  });
  return new Response(Readable.toWeb(file.stream) as ReadableStream, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": att.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(att.fileName),
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
