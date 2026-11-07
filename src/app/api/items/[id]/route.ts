// GET /api/items/[id] — one catalog item, for the quote editor product drawer.
// Signed-in staff only.
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePagePermission("view");
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ ok: false, message: "You don't have permission to do that." }, { status: 403 });
    throw e;
  }
  const { id } = await params;
  const item = await db.item.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      brand: true,
      model: true,
      category: true,
      sku: true,
      unit: true,
      kind: true,
      details: true,
      defaultUnitPrice: true,
      active: true,
    },
  });
  if (!item) return Response.json({ ok: false, message: "Product not found." }, { status: 404 });
  return Response.json({
    ok: true,
    item: { ...item, defaultUnitPrice: item.defaultUnitPrice != null ? String(item.defaultUnitPrice) : null },
  });
}
