// POST /api/customers/parse-2303 — upload a BIR 2303 (PDF or photo) and
// read its text (step 1 of the Claude 2303 parse: no AI, no pre-fill).
// The file is staged on disk (no customer exists yet); the response
// carries its storageKey so the New Customer save can attach it as the
// customer's BIR 2303 document. A file whose text can't be read is
// discarded — the form never blocks on parsing.

import type { NextRequest } from "next/server";
import { requireActionPermission } from "@/lib/auth/current-user";
import { DocRuleError } from "@/lib/documents/common";
import { ForbiddenError } from "@/lib/permissions";
import { discardUploads, prepareUploads } from "@/lib/services/attachments";
import { extractText, type ExtractMime } from "@/lib/2303/extract";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    return await handleParse(req);
  } catch (e) {
    // Never answer a fetch client with an HTML error page: the uploader
    // can only show JSON. The cause travels in the message (staff-facing,
    // signed-in only) so a failure on staging is diagnosable without
    // server access.
    console.error("parse-2303 failed:", e);
    const detail = e instanceof Error ? e.message : "Unknown error.";
    return json(200, { ok: false, message: `Could not read this file (${detail}). Try again, or type the details manually.` });
  }
}

async function handleParse(req: NextRequest) {
  try {
    await requireActionPermission("edit_data");
  } catch (e) {
    if (e instanceof ForbiddenError) return json(403, { ok: false, message: "You don't have permission to do that." });
    throw e;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { ok: false, message: "Upload a PDF, JPG or PNG file." });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { ok: false, message: "Pick a file to upload." });

  const bytes = new Uint8Array(await file.arrayBuffer());
  let upload;
  try {
    const uploads = await prepareUploads([{ name: file.name, size: file.size, bytes }]);
    upload = uploads[0]!;
  } catch (e) {
    if (e instanceof DocRuleError) return json(400, { ok: false, message: e.message });
    throw e;
  }

  try {
    const { text, source } = await extractText(bytes, upload.mimeType as ExtractMime);
    return json(200, { ok: true, text, source, storageKey: upload.storageKey, fileName: upload.fileName });
  } catch (e) {
    // No row points at the staged file, so it isn't kept.
    await discardUploads([upload]);
    return json(200, { ok: false, message: e instanceof Error ? e.message : "Could not read the text from this file." });
  }
}
