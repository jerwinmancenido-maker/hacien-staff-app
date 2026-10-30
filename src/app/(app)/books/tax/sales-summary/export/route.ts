import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { latestFinishedQuarter } from "@/lib/tax/quarters";
import { salesSummaryToCsv } from "@/lib/tax/csv";
import { getSalesSummaryWorksheet } from "@/lib/services/tax-worksheets";

export async function GET(req: Request) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) {
    return NextResponse.json({ error: "Books is turned off." }, { status: 404 });
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get("year");
  const yearNum = raw ? Number(raw) : latestFinishedQuarter().year;
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 ? yearNum : latestFinishedQuarter().year;
  const sheet = await getSalesSummaryWorksheet(user, year);
  const csv = salesSummaryToCsv(sheet.months, year);
  const filename = `hacien-sales-summary-${year}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
