import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { isStorageKey, storagePath } from "@/lib/business-docs/storage";

export const dynamic = "force-dynamic";

/** S-70: serves a user's uploaded signature image. Staff only; the file
    itself is only ever a sniffed PNG/JPEG/WEBP (see user-signature.ts). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in to view this file.", { status: 401 });
  const { id } = await ctx.params;
  const owner = await db.user.findUnique({ where: { id }, select: { signatureStorageKey: true, signatureMimeType: true } });
  const key = owner?.signatureStorageKey?.trim() ?? "";
  const mime = owner?.signatureMimeType ?? "";
  if (!key || !isStorageKey(key) || !mime.startsWith("image/")) return new NextResponse("Not found", { status: 404 });
  const stream = Readable.toWeb(createReadStream(storagePath(key))) as ReadableStream;
  return new NextResponse(stream, {
    headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
