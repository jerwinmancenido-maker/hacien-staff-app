import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { profitMonth } from "@/lib/services/profit";
import { getOperationalProfit, operationalProfitToCsv } from "@/lib/services/reconciliation";

export async function GET(req: Request) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) {
    return NextResponse.json({ error: "Books is turned off." }, { status: 404 });
  }
  const url = new URL(req.url);
  const month = profitMonth(url.searchParams.get("month") ?? undefined);
  const report = await getOperationalProfit(user, month);
  const csv = operationalProfitToCsv(report);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hacien-operations-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
