import type { NextRequest } from "next/server";
import { getItemForApi } from "@/lib/api/items";
import { withApi } from "@/lib/api/guard";
import { apiOk } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(req, { scope: "items:read", permission: "view" }, async (api) => {
    const { id } = await ctx.params;
    return apiOk(await getItemForApi(id, api.user));
  });
}
