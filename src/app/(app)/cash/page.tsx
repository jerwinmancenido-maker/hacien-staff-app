import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatPeso } from "@/lib/format";
import { cashPositionSummary } from "@/lib/services/cash-accounts";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { CASH_ACCOUNT_TYPE_LABELS } from "@/lib/cash/labels";
import { CashNav } from "@/components/cash/CashNav";
import { CASH_DISCLAIMER } from "@/components/cash/CashParts";
import { EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

export default async function CashHomePage() {
  const user = await requirePagePermission("view");
  const canManage = can(user, "manage_cash");
  const summary = await cashPositionSummary();
  // Finding 1037: the headline total is mostly "not assigned" money on real
  // data, so the stat splits it — in-accounts is the accounts' own balances
  // summed with the same scaled arithmetic cashPositionSummary uses, and
  // in-accounts + not assigned always equals the headline total.
  const inAccounts = fromScaled(
    summary.accounts.reduce((a, r) => a + toScaled(r.balance, 2), 0n),
    2,
  );

  return (
    <>
      <PageHeader
        title="Cash"
        subtitle={CASH_DISCLAIMER}
        actions={
          canManage && (
            <Link className="btn" href="/cash/expenses/new">
              <PlusIcon /> Record expense
            </Link>
          )
        }
      />
      <CashNav active="home" />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Cash position</div>
          <div className="value num">{formatPeso(summary.total)}</div>
          <div className="foot">In accounts {formatPeso(inAccounts)} · Not assigned {formatPeso(summary.unassignedNet)}</div>
        </div>
        <Link className="card stat stat-link" href="/cash/accounts">
          <div className="label">Accounts</div>
          <div className="value num">{summary.accounts.length}</div>
          <div className="foot">Active cash / bank / e-wallet →</div>
        </Link>
        <Link className="card stat stat-link" href="/cash/ledger">
          <div className="label">Ledger</div>
          <div className="value">View</div>
          <div className="foot">Dated money in / out →</div>
        </Link>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Balances by account</h2>
          <div className="right">
            {canManage && (
              <Link className="btn-link small" href="/cash/accounts/new">
                Add account →
              </Link>
            )}
          </div>
        </div>
        {summary.accounts.length === 0 ? (
          <div className="empty" style={{ padding: "16px 0" }}>
            <EmptyState
              title="No cash accounts yet"
              line="Add the bank accounts and wallets you track by hand. Opening balances start the running total."
            />
            {canManage && (
              <p style={{ marginTop: 12 }}>
                <Link className="btn" href="/cash/accounts/new">
                  Add your first bank account
                </Link>
              </p>
            )}
            {!canManage && (
              <p className="faint small" style={{ marginTop: 12 }}>
                Ask an Admin or Approver to add the first account.
              </p>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="list" aria-label="Cash position">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="col-phone-hide">Type</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {summary.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={a.href}>{a.name}</Link>
                      {a.accountHintLast4 && <div className="faint small">···{a.accountHintLast4}</div>}
                    </td>
                    <td className="col-phone-hide">{CASH_ACCOUNT_TYPE_LABELS[a.type]}</td>
                    <td className={`num strong${Number(a.balance) < 0 ? " neg" : ""}`}>{formatPeso(a.balance)}</td>
                  </tr>
                ))}
                {Number(summary.unassignedNet) !== 0 && (
                  <tr>
                    <td>
                      Not assigned
                      <div className="faint small">Old collections / payments with no account yet</div>
                    </td>
                    <td className="col-phone-hide">—</td>
                    <td className="num">{formatPeso(summary.unassignedNet)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
