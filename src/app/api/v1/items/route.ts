import type { NextRequest } from "next/server";
import { listItemsForApi } from "@/lib/api/items";
import { withApi } from "@/lib/api/guard";
import { apiOk } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withApi(req, { scope: "items:read", permission: "view" }, async (ctx) => {
    return apiOk(await listItemsForApi(req.nextUrl.searchParams, ctx.user));
  });
}
