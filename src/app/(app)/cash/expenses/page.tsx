import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { money } from "@/lib/documents/common";
import { listExpenses } from "@/lib/services/expenses";
import { CashNav } from "@/components/cash/CashNav";
import { CASH_DISCLAIMER, ExpenseStatusChip } from "@/components/cash/CashParts";
import { EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

const day = (d: Date) => formatDate(d);

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePagePermission("view");
  const canManage = can(user, "manage_cash");
  const sp = await searchParams;
  const status = sp.status === "VOID" || sp.status === "POSTED" ? sp.status : "ALL";
  const rows = await listExpenses({ status, q: sp.q });

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle={`Company costs paid from cash or bank. ${CASH_DISCLAIMER}`}
        actions={
          canManage && (
            <Link className="btn" href="/cash/expenses/new">
              <PlusIcon /> Record expense
            </Link>
          )
        }
      />
      <CashNav active="expenses" />
      <div className="card">
        <form className="filters" method="get" style={{ marginBottom: 16 }}>
          <input name="q" placeholder="Search number, payee, receipt…" defaultValue={sp.q ?? ""} />
          <select name="status" defaultValue={status}>
            <option value="ALL">All statuses</option>
            <option value="POSTED">Posted</option>
            <option value="VOID">Void</option>
          </select>
          <button className="btn btn-secondary" type="submit">
            Filter
          </button>
        </form>
        {rows.length === 0 ? (
          <div className="empty" style={{ padding: "8px 0" }}>
            <EmptyState title="No expenses yet" line="Record rent, utilities, internet and other costs paid from your accounts." />
            {canManage && (
              <p style={{ marginTop: 12 }}>
                <Link className="btn" href="/cash/expenses/new">
                  Record your first expense
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
                  <th>Payee</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/cash/expenses/${e.id}`}>{e.number}</Link>
                    </td>
                    <td>{day(e.date)}</td>
                    <td>{e.supplier?.name ?? e.payeeText ?? "—"}</td>
                    <td>{e.category.label}</td>
                    <td>
                      <Link href={`/cash/accounts/${e.cashAccount.id}`}>{e.cashAccount.name}</Link>
                    </td>
                    <td className="num">{formatPeso(money(e.amount))}</td>
                    <td>
                      <ExpenseStatusChip status={e.status} />
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
