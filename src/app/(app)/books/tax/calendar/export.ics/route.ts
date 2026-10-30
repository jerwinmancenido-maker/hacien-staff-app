import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { TAX_CALENDAR_ICS_FILENAME } from "@/lib/tax/calendar-constants";
import { buildTaxCalendarIcs } from "@/lib/tax/calendar-ics";
import { listTaxCalendar } from "@/lib/services/tax-calendar";

/** Owner-only .ics download (manage_settings). No calendar API; no email; no customer data. */
export async function GET() {
  const user = await requirePagePermission("manage_settings");
  if (!(await isBooksEnabled())) {
    return NextResponse.json({ error: "Books is turned off." }, { status: 404 });
  }

  const { rows } = await listTaxCalendar(user, { view: "all" });
  const body = buildTaxCalendarIcs(rows);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${TAX_CALENDAR_ICS_FILENAME}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
