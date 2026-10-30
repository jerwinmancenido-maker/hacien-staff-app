// GET /files/business-documents/:id — streams an uploaded business document to
// a signed-in user with "view" permission (see src/lib/business-docs/download.ts).

import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { clientIp } from "@/lib/auth/client-ip";
import { businessDocumentDownload } from "@/lib/business-docs/download";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  return businessDocumentDownload(user, id, { ip: clientIp(req.headers) });
}
