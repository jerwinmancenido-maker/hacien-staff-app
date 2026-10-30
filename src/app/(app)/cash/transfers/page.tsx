import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { money } from "@/lib/documents/common";
import { listCashTransfers } from "@/lib/services/cash-transfers";
import { CashNav } from "@/components/cash/CashNav";
import { CASH_DISCLAIMER, TransferStatusChip } from "@/components/cash/CashParts";
import { EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

export default async function TransfersPage() {
  const user = await requirePagePermission("view");
  const canManage = can(user, "manage_cash");
  const rows = await listCashTransfers();

  return (
    <>
      <PageHeader
        title="Transfers"
        subtitle={`Move money between your accounts (e.g. bank deposit of cash). ${CASH_DISCLAIMER}`}
        actions={
          canManage && (
            <Link className="btn" href="/cash/transfers/new">
              <PlusIcon /> Record transfer
            </Link>
          )
        }
      />
      <CashNav active="transfers" />
      <div className="card">
        {rows.length === 0 ? (
          <div className="empty" style={{ padding: "8px 0" }}>
            <EmptyState title="No transfers yet" line="Record when you move money from one account to another." />
            {canManage && (
              <p style={{ marginTop: 12 }}>
                <Link className="btn" href="/cash/transfers/new">
                  Record a transfer
                </Link>
              </p>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/cash/transfers/${t.id}`}>{t.number}</Link>
                    </td>
                    <td>{formatDate(t.date)}</td>
                    <td>
                      <Link href={`/cash/accounts/${t.fromAccount.id}`}>{t.fromAccount.name}</Link>
                    </td>
                    <td>
                      <Link href={`/cash/accounts/${t.toAccount.id}`}>{t.toAccount.name}</Link>
                    </td>
                    <td className="num">{formatPeso(money(t.amount))}</td>
                    <td>
                      <TransferStatusChip status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
