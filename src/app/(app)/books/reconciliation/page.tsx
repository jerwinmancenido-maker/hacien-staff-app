import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { BOOKS_DISCLAIMER } from "@/lib/books/config";
import { formatDate, formatPeso } from "@/lib/format";
import { BooksBanner } from "@/components/books/BooksBanner";
import { BooksNav } from "@/components/books/BooksNav";
import { EmptyState, PageHeader } from "@/components/ui";
import { listBusinesses } from "@/lib/services/businesses";
import { getReconciliation, type ReconList } from "@/lib/services/reconciliation";

// Reconciliation (PR-C): where the operational record and the official
// documents have not caught up with each other. Admin-only — it is the
// most sensitive summary in the app. Read-only: creating the missing
// billing / supplier bill from the SO / PO closes a row by itself.
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;

  if (!user.isAdmin) {
    return (
      <>
        <PageHeader title="Reconciliation" subtitle={BOOKS_DISCLAIMER} />
        <BooksNav active="reconciliation" />
        <div className="card">
          <p style={{ margin: 0 }}>This page is for Admins only.</p>
        </div>
      </>
    );
  }

  const businesses = await listBusinesses();
  const filter = sp.business === "own" || businesses.some((b) => b.id === sp.business) ? sp.business! : "all";
  const recon = await getReconciliation(user, filter);

  const sections: { key: string; title: string; explain: string; list: ReconList }[] = [
    {
      key: "delivered",
      title: "Delivered, not billed",
      explain: "Goods went out on these orders, but the billed total is below the contract price. The amount is the unbilled remainder.",
      list: recon.deliveredNotBilled,
    },
    {
      key: "billed",
      title: "Billed, not delivered",
      explain: "These orders were billed before everything was delivered. The amount is the billed total.",
      list: recon.billedNotDelivered,
    },
    {
      key: "grni",
      title: "Received, not invoiced (GRNI)",
      explain: "Goods were received on these purchase orders, but the supplier bills recorded are below the received value. The amount is the uninvoiced remainder.",
      list: recon.receivedNotInvoiced,
    },
    {
      key: "bill",
      title: "Bill recorded, goods not received",
      explain: "These supplier bills are ahead of receiving. The amount is the part of the bill not yet covered by received goods.",
      list: recon.billNotReceived,
    },
  ];

  return (
    <>
      <PageHeader title="Reconciliation" subtitle={`Admin only · Read-only — no document flow changes here · ${BOOKS_DISCLAIMER}`} />
      <BooksNav active="reconciliation" />
      <BooksBanner />
      {businesses.length > 0 && (
        <form className="toolbar" action="/books/reconciliation" method="get" style={{ marginBottom: 12 }}>
          <label htmlFor="business">Business</label>
          <select id="business" name="business" defaultValue={filter}>
            <option value="all">All businesses</option>
            <option value="own">Own company only</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" type="submit">
            Show
          </button>
        </form>
      )}
      {sections.map((s) => (
        <div className="card" key={s.key}>
          <h2 style={{ marginTop: 0 }}>
            {s.title} — {formatPeso(s.list.total)} ({s.list.count} open)
          </h2>
          <p className="faint small">{s.explain}</p>
          {s.list.rows.length === 0 ? (
            <EmptyState line="Nothing open here." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="list" aria-label={s.title}>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Party</th>
                      {businesses.length > 0 && <th>Business</th>}
                      <th>Gap opened</th>
                      <th>Days open</th>
                      <th>Aging</th>
                      <th className="num">Amount</th>
                      <th>Detail</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.list.rows.map((r) => (
                      <tr key={`${s.key}-${r.id}`}>
                        <td data-col="number">
                          <Link href={r.href}>{r.number}</Link>
                        </td>
                        <td>{r.party}</td>
                        {businesses.length > 0 && <td>{r.businessLabel ?? "—"}</td>}
                        <td data-col="date">{formatDate(new Date(`${r.openedYmd}T00:00:00.000Z`))}</td>
                        <td className="num">{r.daysOpen}</td>
                        <td>{r.bucket}</td>
                        <td className="num">{formatPeso(r.amount)}</td>
                        <td>{r.detail}</td>
                        <td>
                          {r.gapReason ?? "—"}
                          {r.gapNote ? <div className="faint small">{r.gapNote}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ marginBottom: 0 }}>
                <Link className="btn btn-secondary" href={`/books/reconciliation/export?list=${s.key}&business=${filter}`}>
                  Export CSV
                </Link>
              </p>
            </>
          )}
        </div>
      ))}
    </>
  );
}
