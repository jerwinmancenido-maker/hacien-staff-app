// GET /api/items/search?q= — catalog picker for the quote editor.
// Signed-in staff only; returns active catalog items matching the query.
import type { NextRequest } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { ForbiddenError } from "@/lib/permissions";
import { searchCatalogItems } from "@/lib/items/search";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePagePermission("view");
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ ok: false, message: "You don't have permission to do that." }, { status: 403 });
    throw e;
  }
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const items = await searchCatalogItems(q);
  return Response.json({ ok: true, items });
}
