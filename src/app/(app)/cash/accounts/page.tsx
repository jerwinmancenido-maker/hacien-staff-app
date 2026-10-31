import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatPeso } from "@/lib/format";
import { money, ymd } from "@/lib/documents/common";
import { cashAccountBalance, listCashAccounts } from "@/lib/services/cash-accounts";
import { CASH_ACCOUNT_TYPE_LABELS } from "@/lib/cash/labels";
import { AccountActiveChip, CASH_DISCLAIMER } from "@/components/cash/CashParts";
import { CashNav } from "@/components/cash/CashNav";
import { EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

export default async function CashAccountsPage() {
  const user = await requirePagePermission("view");
  const canManage = can(user, "manage_cash");
  const accounts = await listCashAccounts(true);
  const withBal = await Promise.all(
    accounts.map(async (a) => ({
      ...a,
      balance: await cashAccountBalance(a.id),
      openingBalance: money(a.openingBalance),
      openingDate: ymd(a.openingDate)!,
    })),
  );

  return (
    <>
      <PageHeader
        title="Cash accounts"
        subtitle={CASH_DISCLAIMER}
        actions={
          canManage && (
            <Link className="btn" href="/cash/accounts/new">
              <PlusIcon /> Add account
            </Link>
          )
        }
      />
      <CashNav active="accounts" />
      <div className="card">
        {withBal.length === 0 ? (
          <div className="empty" style={{ padding: "8px 0" }}>
            <EmptyState title="No accounts yet" line="Add cash on hand, a bank account, or an e-wallet to start the ledger." />
            {canManage ? (
              <p style={{ marginTop: 12 }}>
                <Link className="btn" href="/cash/accounts/new">
                  Add your first bank account
                </Link>
              </p>
            ) : (
              <p className="faint small" style={{ marginTop: 12 }}>
                Ask an Admin or Approver to add an account.
              </p>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Opening</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {withBal.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/cash/accounts/${a.id}`}>{a.name}</Link>
                      {a.accountHintLast4 && <div className="faint small">···{a.accountHintLast4}{a.bankName ? ` · ${a.bankName}` : ""}</div>}
                    </td>
                    <td>{CASH_ACCOUNT_TYPE_LABELS[a.type]}</td>
                    <td>
                      {formatPeso(a.openingBalance)}
                      <div className="faint small">{a.openingDate}</div>
                    </td>
                    <td className="num strong">{formatPeso(a.balance)}</td>
                    <td>
                      <AccountActiveChip active={a.active} />
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
