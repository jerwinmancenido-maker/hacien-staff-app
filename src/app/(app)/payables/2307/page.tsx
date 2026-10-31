import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { ymd } from "@/lib/documents/common";
import { isPayables2307Enabled } from "@/lib/payables/issue2307";
import { listSupplier2307 } from "@/lib/payables/views";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { Supplier2307StatusChip } from "@/components/payables/PayablesParts";
import { Mark2307IssuedForm } from "@/components/payables/Mark2307IssuedForm";
import { PageHeader } from "@/components/ui";
import type { SupplierWithholding2307Status } from "@prisma/client";
import { markSupplier2307IssuedAction } from "../actions";

const day = (ymdStr: string | null) => (ymdStr ? formatDate(new Date(`${ymdStr}T00:00:00.000Z`)) : "—");

export default async function Supplier2307Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!(await isPayables2307Enabled())) redirect("/payables");
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  const status = (sp.status === "TO_ISSUE" || sp.status === "ISSUED" ? sp.status : "TO_ISSUE") as SupplierWithholding2307Status | "ALL";
  const rows = await listSupplier2307({ status });
  const canManage = can(user, "manage_payables");
  const today = ymd(manilaToday())!;

  return (
    <>
      <PageHeader
        title="2307 to issue"
        subtitle="EWT on supplier payments — record status only. App does not generate BIR Form 2307. UNVERIFIED whether HACIEN must withhold (pending RDO)."
      />
      <PayablesNav active="2307" />
      <form className="toolbar txn-filters" method="get" action="/payables/2307" style={{ marginBottom: 16 }}>
        <select className="input" name="status" defaultValue={status}>
          <option value="TO_ISSUE">To issue</option>
          <option value="ISSUED">Issued</option>
          <option value="ALL">All</option>
        </select>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      <div className="card">
        <div className="table-wrap">
          <table className="list" aria-label="2307 to issue">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Payment</th>
                <th>Bill</th>
                <th className="num">Amount</th>
                <th>Rate</th>
                <th>ATC</th>
                <th>Status</th>
                <th>Issued</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty" style={{ padding: "24px 8px" }}>
                      <p className="faint">
                        {status === "TO_ISSUE"
                          ? "No 2307 certificates waiting to be issued."
                          : "Nothing matches this filter."}
                      </p>
                      <p className="faint small">
                        2307 rows appear when a payment includes withholding (EWT). Whether HACIEN must withhold is still unverified (pending RDO).
                      </p>
                      {canManage && (
                        <p style={{ marginTop: 8 }}>
                          <Link className="btn" href="/payables/payments/new">
                            Record a payment
                          </Link>
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/suppliers/${r.supplier.id}`}>{r.supplier.name}</Link>
                    </td>
                    <td>{r.payment ? <Link href={`/payables/payments/${r.payment.id}`}>{r.payment.number}</Link> : "—"}</td>
                    <td>{r.bill?.billNumber ?? "—"}</td>
                    <td className="num">{formatPeso(r.amount)}</td>
                    <td>{(Number(r.rate) * 100).toFixed(2)}%</td>
                    <td>{r.atcCode ?? "—"}</td>
                    <td>
                      <Supplier2307StatusChip status={r.status} />
                    </td>
                    <td>{day(r.issuedAt)}</td>
                    <td>
                      {canManage && r.status === "TO_ISSUE" && (
                        <Mark2307IssuedForm action={markSupplier2307IssuedAction.bind(null, r.id)} defaultDate={today} />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
