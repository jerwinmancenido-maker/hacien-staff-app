import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { list2307 } from "@/lib/billing/views";
import { BillingNav } from "@/components/billing/BillingNav";
import { Mark2307Form } from "@/components/billing/Mark2307Form";
import { Chip, PageHeader } from "@/components/ui";
import type { Withholding2307Status } from "@prisma/client";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export default async function Withholding2307Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; customerId?: string }>;
}) {
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  const status = (sp.status === "PENDING" || sp.status === "RECEIVED" ? sp.status : "ALL") as Withholding2307Status | "ALL";
  const rows = await list2307({ status, customerId: sp.customerId });
  const canManage = can(user, "manage_billing");

  return (
    <>
      <PageHeader title="BIR 2307" subtitle="Creditable tax withheld. Pending until the certificate is received." />
      <BillingNav active="2307" />
      <form className="toolbar txn-filters" method="get" action="/billing/2307" style={{ marginBottom: 16 }}>
        <select className="input" name="status" defaultValue={status}>
          <option value="ALL">All</option>
          <option value="PENDING">Pending</option>
          <option value="RECEIVED">Received</option>
        </select>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      <div className="card">
        <div className="table-wrap">
          <table className="list" aria-label="2307s">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Billing</th>
                <th>Collection</th>
                <th>ATC</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="faint">
                    No 2307 records.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/customers/${r.customer.id}`}>{r.customer.name}</Link>
                    </td>
                    <td>
                      {r.billing ? (
                        <Link href={`/billing/billings/${r.billing.id}`}>
                          #{r.billing.invoiceNo} · {r.billing.number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {r.collection ? <Link href={`/billing/collections/${r.collection.id}`}>{r.collection.number}</Link> : "—"}
                    </td>
                    <td>{r.atcCode ?? "—"}</td>
                    <td className="num">{(Number(r.rate) * 100).toFixed(2)}%</td>
                    <td className="num">{formatPeso(r.amount)}</td>
                    <td>
                      <Chip tone={r.status === "RECEIVED" ? "green" : "amber"}>{r.status === "RECEIVED" ? "Received" : "Pending"}</Chip>
                    </td>
                    <td>{day(r.receivedAt)}</td>
                    <td>
                      {r.status === "PENDING" && canManage && <Mark2307Form id={r.id} />}
                      {r.attachments.map((a) => (
                        <div key={a.id}>
                          <a className="btn-link small" href={a.href}>
                            {a.fileName}
                          </a>
                        </div>
                      ))}
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
