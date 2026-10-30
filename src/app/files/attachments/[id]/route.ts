// GET /files/attachments/:id — streams a receiving report or supplier bill
// attachment (see src/lib/attachments-download.ts for who may download what).

import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { clientIp } from "@/lib/auth/client-ip";
import { attachmentDownload } from "@/lib/attachments-download";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  return attachmentDownload(user, id, { ip: clientIp(req.headers) });
}
