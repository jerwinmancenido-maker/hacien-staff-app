// GET /api/items/supplier-costs?description= — per-supplier last PO costs
// for one item description, used by the quote editor's cost auto-fill.
// Cost data is sensitive: signed-in staff who can see costs only.
import type { NextRequest } from "next/server";
import { requireCostAction } from "@/lib/auth/current-user";
import { ForbiddenError } from "@/lib/permissions";
import { listSupplierPriceComparison } from "@/lib/items/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireCostAction("view");
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ ok: false, message: "You don't have permission to do that." }, { status: 403 });
    throw e;
  }
  const description = req.nextUrl.searchParams.get("description") ?? "";
  const rows = await listSupplierPriceComparison(description);
  return Response.json({ ok: true, rows });
}
