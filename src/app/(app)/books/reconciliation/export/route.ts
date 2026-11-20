import { NextResponse } from "next/server";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { isoDate, manilaToday } from "@/lib/format";
import { listBusinesses } from "@/lib/services/businesses";
import { getReconciliation, reconciliationToCsv, type Reconciliation } from "@/lib/services/reconciliation";

const LISTS: Record<string, { title: string; pick: (r: Reconciliation) => Reconciliation["deliveredNotBilled"] }> = {
  delivered: { title: "Delivered, not billed", pick: (r) => r.deliveredNotBilled },
  billed: { title: "Billed, not delivered", pick: (r) => r.billedNotDelivered },
  grni: { title: "Received, not invoiced (GRNI)", pick: (r) => r.receivedNotInvoiced },
  bill: { title: "Bill recorded, goods not received", pick: (r) => r.billNotReceived },
};

export async function GET(req: Request) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) {
    return NextResponse.json({ error: "Books is turned off." }, { status: 404 });
  }
  if (!user.isAdmin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const url = new URL(req.url);
  const entry = LISTS[url.searchParams.get("list") ?? ""];
  if (!entry) return NextResponse.json({ error: "Unknown list." }, { status: 404 });
  const businesses = await listBusinesses();
  const raw = url.searchParams.get("business") ?? "all";
  const filter = raw === "own" || businesses.some((b) => b.id === raw) ? raw : "all";
  const recon = await getReconciliation(user, filter);
  const csv = reconciliationToCsv(entry.title, entry.pick(recon));
  // E12: name the file for the business filter + the Manila date.
  const businessSlug =
    filter === "all" ? "all-businesses" : filter === "own" ? "own-company" : (businesses.find((b) => b.id === filter)?.shortLabel ?? "business").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fileName = `hacien-reconciliation-${url.searchParams.get("list")}-${businessSlug}-${isoDate(manilaToday())}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
