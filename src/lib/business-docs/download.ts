// Download of a business document, kept apart from the route handler so the
// permission matrix can be tested without a request. Signed out → 401; no
// "view" permission → 403; unknown id or missing file → 404. The file is read
// by its storage key only (never a path or name from the request).

import { Readable } from "node:stream";
import { db } from "../db";
import { writeAudit } from "../audit";
import { can, type PermissionUser } from "../permissions";
import { openFile } from "./storage";

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
} as const;

function text(status: number, body: string) {
  return new Response(body, { status, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

/** attachment; filename="ascii fallback"; filename*=UTF-8''percent-encoded */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function businessDocumentDownload(
  user: (PermissionUser & { id: string }) | null,
  id: string,
  meta: { ip?: string | null } = {},
): Promise<Response> {
  if (!user) return text(401, "Sign in to download this file.");
  if (!can(user, "view")) return text(403, "You don't have permission to download this file.");
  if (!/^[a-z0-9]{1,64}$/i.test(id)) return text(404, "Not found.");
  const doc = await db.businessDocument.findUnique({ where: { id } });
  if (!doc) return text(404, "Not found.");
  const file = await openFile(doc.storageKey).catch(() => null);
  if (!file) return text(404, "The file is missing from storage.");
  await writeAudit(db, {
    userId: user.id,
    entityType: "BusinessDocument",
    entityId: doc.id,
    action: "download",
    after: { fileName: doc.fileName, customerId: doc.customerId, supplierId: doc.supplierId },
    diff: false,
    ip: meta.ip ?? null,
  });
  return new Response(Readable.toWeb(file.stream) as ReadableStream, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": doc.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(doc.fileName),
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
