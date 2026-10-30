import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { isStorageKey, storagePath } from "@/lib/business-docs/storage";

export const dynamic = "force-dynamic";

/** Serves the company logo from Settings (storage key). Auth required. */
export async function GET() {
  await requirePagePermission("view");
  const snap = await getSettingsSnapshot();
  const key = snap.settings.company.logoStorageKey?.trim() ?? "";
  if (!key || !isStorageKey(key)) return new NextResponse("Not found", { status: 404 });
  const path = storagePath(key);
  try {
    const info = await stat(path);
    if (!info.isFile()) return new NextResponse("Not found", { status: 404 });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
