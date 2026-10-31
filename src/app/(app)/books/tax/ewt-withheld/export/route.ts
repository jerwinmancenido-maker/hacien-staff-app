import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { parseTaxQuarter } from "@/lib/tax/quarters";
import { supplierEwtToQapCsv } from "@/lib/tax/csv";
import { getSupplierEwtWorksheet } from "@/lib/services/tax-worksheets";

export async function GET(req: Request) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) {
    return NextResponse.json({ error: "Books is turned off." }, { status: 404 });
  }
  const url = new URL(req.url);
  const period = parseTaxQuarter(url.searchParams.get("year"), url.searchParams.get("quarter"));
  const sheet = await getSupplierEwtWorksheet(user, period.year, period.quarter);
  const csv = supplierEwtToQapCsv(sheet.rows, { year: period.year, quarter: period.quarter });
  const filename = `hacien-qap-unverified-Q${period.quarter}-${period.year}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
