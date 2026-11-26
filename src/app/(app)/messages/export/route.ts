import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { getOptedInContactsCsv } from "@/lib/marketing-consent";
import { getSettingsSnapshot } from "@/lib/settings";
import { csvDownloadName } from "@/lib/settings/identity";

/** Admin-only CSV export of opted-in contacts only (Q17, S-96). */
export async function GET() {
  await requirePagePermission("manage_settings");
  const { settings } = await getSettingsSnapshot();
  const csv = await getOptedInContactsCsv();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvDownloadName(settings.identity.csvFilePrefix, "marketing-consent-opted-in.csv")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
