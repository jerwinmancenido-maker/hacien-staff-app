import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { getMonthlyProfit, profitMonth, profitToCsv } from "@/lib/services/profit";

export async function GET(req: Request) {
  await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) {
    return NextResponse.json({ error: "Books is turned off." }, { status: 404 });
  }
  const url = new URL(req.url);
  const month = profitMonth(url.searchParams.get("month"));
  const report = await getMonthlyProfit(month);
  const csv = profitToCsv(report);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hacien-profit-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
