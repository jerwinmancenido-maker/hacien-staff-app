import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { money, ymd } from "@/lib/documents/common";
import { db } from "@/lib/db";
import { buildLedger, ledgerToCsv } from "@/lib/cash/balance";
import { isCashEnabled } from "@/lib/cash/features";
import { ledgerEntriesForAccount } from "@/lib/services/cash-accounts";

export async function GET(req: Request) {
  await requirePagePermission("view");
  if (!(await isCashEnabled())) {
    return NextResponse.json({ error: "Cash is turned off." }, { status: 404 });
  }
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "Pick an account." }, { status: 400 });
  const account = await db.cashAccount.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromYmd = from?.match(/^\d{4}-\d{2}-\d{2}$/) ? from : null;
  const toYmd = to?.match(/^\d{4}-\d{2}-\d{2}$/) ? to : null;
  const entries = await ledgerEntriesForAccount(accountId);
  const rows = buildLedger({
    openingBalance: money(account.openingBalance),
    openingDate: ymd(account.openingDate)!,
    entries,
    fromYmd,
    toYmd,
  });
  const csv = ledgerToCsv(rows);
  const filename = `${account.name.replace(/[^\w.-]+/g, "_")}-ledger.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
