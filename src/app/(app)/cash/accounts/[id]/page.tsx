import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso, isoDate } from "@/lib/format";
import { money, ymd } from "@/lib/documents/common";
import { db } from "@/lib/db";
import { buildLedger } from "@/lib/cash/balance";
import { cashAccountBalance, ledgerEntriesForAccount } from "@/lib/services/cash-accounts";
import { CASH_ACCOUNT_TYPE_HINTS, CASH_ACCOUNT_TYPE_LABELS } from "@/lib/cash/labels";
import { Activity } from "@/components/Activity";
import { AccountForm } from "@/components/cash/AccountForm";
import { AccountActiveChip, CASH_DISCLAIMER } from "@/components/cash/CashParts";
import { CashNav } from "@/components/cash/CashNav";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader } from "@/components/ui";
import { updateCashAccountAction } from "../../actions";

const day = (ymdStr: string | null) => (ymdStr ? formatDate(new Date(`${ymdStr}T00:00:00.000Z`)) : "—");

export default async function CashAccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: raw } = await searchParams;
  const tab = raw === "edit" || raw === "ledger" ? raw : "overview";
  const account = await db.cashAccount.findUnique({ where: { id } });
  if (!account) notFound();
  const canManage = can(user, "manage_cash");
  const balance = await cashAccountBalance(id);
  const entries = await ledgerEntriesForAccount(id);
  const ledger = buildLedger({
    openingBalance: money(account.openingBalance),
    openingDate: ymd(account.openingDate)!,
    entries,
  }).slice(-20);

  return (
    <>
      <PageHeader
        title={
          <>
            {account.name}
            <AccountActiveChip active={account.active} />
          </>
        }
        subtitle={`${CASH_ACCOUNT_TYPE_LABELS[account.type]} · ${CASH_DISCLAIMER}`}
        actions={
          canManage && tab !== "edit" ? (
            <Link className="btn btn-secondary" href={`/cash/accounts/${id}?tab=edit`}>
              Edit
            </Link>
          ) : null
        }
      />
      <CashNav active="accounts" />

      <div className="detail-grid">
        <div className="card">
          <dl className="kv kv-grid">
            <dt>Type</dt>
            <dd>
              {CASH_ACCOUNT_TYPE_LABELS[account.type]}
              <div className="hint">{CASH_ACCOUNT_TYPE_HINTS[account.type]}</div>
            </dd>
            {account.bankName && (
              <>
                <dt>Bank / provider</dt>
                <dd>{account.bankName}</dd>
              </>
            )}
            <dt>Last 4 digits</dt>
            <dd>{account.accountHintLast4 ? `···${account.accountHintLast4}` : "—"}</dd>
            <dt>Opening</dt>
            <dd>
              {formatPeso(money(account.openingBalance))} on {day(ymd(account.openingDate))}
            </dd>
            <dt>Running balance</dt>
            <dd className="num strong">{formatPeso(balance)}</dd>
          </dl>
        </div>
        <Activity targets={[{ entityType: "CashAccount", ids: [id] }]} viewer={user} />
      </div>

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/cash/accounts/${id}` },
          { key: "ledger", label: "Recent ledger", href: `/cash/accounts/${id}?tab=ledger` },
          ...(canManage ? [{ key: "edit", label: "Edit", href: `/cash/accounts/${id}?tab=edit` }] : []),
        ]}
      />

      {tab === "overview" && (
        <div className="card">
          <p className="faint small">
            Status and balance are at the top. Use the ledger tab for recent money in and out, or open the full{" "}
            <Link href={`/cash/ledger?accountId=${id}`}>account ledger</Link>.
          </p>
        </div>
      )}

      {tab === "ledger" && (
        <div className="card">
          {ledger.length === 0 ? (
            <p className="faint">No movements yet besides opening balance.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Number</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={r.id}>
                      <td>{day(r.date)}</td>
                      <td>{r.href ? <Link href={r.href}>{r.number}</Link> : r.number}</td>
                      <td>{r.description}</td>
                      <td className="num">{formatPeso(r.signedAmount)}</td>
                      <td className="num">{formatPeso(r.runningBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 12 }}>
            <Link className="btn-link small" href={`/cash/ledger?accountId=${id}`}>
              Full ledger with date filter →
            </Link>
          </p>
        </div>
      )}

      {tab === "edit" && canManage && (
        <div className="card" style={{ maxWidth: 720 }}>
          <AccountForm
            action={updateCashAccountAction.bind(null, id)}
            canEdit
            mode="edit"
            defaults={{
              name: account.name,
              type: account.type,
              bankName: account.bankName ?? "",
              accountHintLast4: account.accountHintLast4 ?? "",
              openingBalance: money(account.openingBalance),
              openingDate: isoDate(account.openingDate),
              active: account.active,
            }}
          />
        </div>
      )}
    </>
  );
}
