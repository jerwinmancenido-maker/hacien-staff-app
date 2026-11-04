import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { getOptedInContactsCsv } from "@/lib/marketing-consent";

/** Admin-only CSV export of opted-in contacts only (Q17, S-96). */
export async function GET() {
  await requirePagePermission("manage_settings");
  const csv = await getOptedInContactsCsv();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hacien-marketing-consent-opted-in.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
