import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { isRegisterKey, REGISTER_CONFIGS } from "@/lib/books/config";
import { parseBooksPeriod } from "@/lib/books/period";
import { registerToCsv } from "@/lib/books/registers";
import { getBookRegister } from "@/lib/services/books";

export async function GET(req: Request, ctx: { params: Promise<{ register: string }> }) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) {
    return NextResponse.json({ error: "Books is turned off." }, { status: 404 });
  }
  const { register: raw } = await ctx.params;
  if (!isRegisterKey(raw)) {
    return NextResponse.json({ error: "Unknown register." }, { status: 404 });
  }
  const config = REGISTER_CONFIGS[raw];
  const url = new URL(req.url);
  const period = parseBooksPeriod(url.searchParams.get("from"), url.searchParams.get("to"));
  const { register } = await getBookRegister(user, raw, period.fromYmd, period.toYmd);
  const csv = registerToCsv(config, register);
  const filename = `hacien-${config.path}-${period.fromYmd}_to_${period.toYmd}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
