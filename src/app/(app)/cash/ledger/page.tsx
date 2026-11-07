import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDate, formatPeso } from "@/lib/format";
import { money, ymd } from "@/lib/documents/common";
import { db } from "@/lib/db";
import { buildLedger } from "@/lib/cash/balance";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { ledgerEntriesForAccount, listCashAccounts } from "@/lib/services/cash-accounts";
import { CashNav } from "@/components/cash/CashNav";
import { CASH_DISCLAIMER } from "@/components/cash/CashParts";
import { LedgerFilters } from "@/components/cash/LedgerFilters";
import { EmptyState, PageHeader } from "@/components/ui";

const day = (ymdStr: string) => formatDate(new Date(`${ymdStr}T00:00:00.000Z`));

export default async function CashLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; from?: string; to?: string; export?: string }>;
}) {
  await requirePagePermission("view");
  const sp = await searchParams;
  const accounts = await listCashAccounts(true);
  const from = sp.from?.match(/^\d{4}-\d{2}-\d{2}$/) ? sp.from : null;
  const to = sp.to?.match(/^\d{4}-\d{2}-\d{2}$/) ? sp.to : null;
  // "unassigned" is a pseudo-account: money with no cash account yet. It is also the
  // fallback when no accounts exist at all, so unassigned movement is never hidden.
  const accountId =
    sp.accountId === "unassigned"
      ? "unassigned"
      : sp.accountId && accounts.some((a) => a.id === sp.accountId)
        ? sp.accountId
        : (accounts.find((a) => a.active)?.id ?? accounts[0]?.id ?? "unassigned");
  const isUnassigned = accountId === "unassigned";

  let subtitle: string;
  let rows: ReturnType<typeof buildLedger>;
  if (isUnassigned) {
    const entries = await ledgerEntriesForAccount(null);
    subtitle = `Unassigned · ${CASH_DISCLAIMER}`;
    if (entries.length === 0) {
      return (
        <>
          <PageHeader title="Account ledger" subtitle={subtitle} />
          <CashNav active="ledger" />
          <div className="card">
            <LedgerFilters
              accounts={accounts.map((a) => ({ id: a.id, name: a.name, active: a.active }))}
              accountId={accountId}
              from={from}
              to={to}
            />
            <EmptyState
              title="No unassigned money movement yet"
              line="Collections and supplier payments with no cash account will show here."
            />
            {accounts.length === 0 ? (
              <p style={{ marginTop: 12 }}>
                <Link className="btn" href="/cash/accounts/new">
                  Add your first bank account
                </Link>
              </p>
            ) : null}
          </div>
        </>
      );
    }
    const openingDate = entries.reduce((m, e) => (e.date < m ? e.date : m), entries[0]!.date);
    rows = buildLedger({ openingBalance: "0.00", openingDate, entries, fromYmd: from, toYmd: to });
  } else {
    const account = await db.cashAccount.findUniqueOrThrow({ where: { id: accountId } });
    const entries = await ledgerEntriesForAccount(accountId);
    subtitle = `${account.name} · ${CASH_DISCLAIMER}`;
    rows = buildLedger({
      openingBalance: money(account.openingBalance),
      openingDate: ymd(account.openingDate)!,
      entries,
      fromYmd: from,
      toYmd: to,
    });
  }

  return (
    <>
      <PageHeader title="Account ledger" subtitle={subtitle} />
      <CashNav active="ledger" />
      <div className="card">
        <LedgerFilters
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, active: a.active }))}
          accountId={accountId}
          from={from}
          to={to}
        />

        {rows.length === 0 ? (
          <p className="faint">No rows in this date range.</p>
        ) : (
          <div className="table-wrap">
            <table className="list" aria-label="Account ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Number</th>
                  <th>Description</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const signed = toScaled(r.signedAmount, 2);
                  const inn = signed > 0n ? fromScaled(signed, 2) : "";
                  const out = signed < 0n ? fromScaled(-signed, 2) : "";
                  return (
                    <tr key={r.id}>
                      <td>{day(r.date)}</td>
                      <td>{r.kind.replace(/_/g, " ")}</td>
                      <td>{r.href ? <Link href={r.href}>{r.number}</Link> : r.number}</td>
                      <td>{r.description}</td>
                      <td className="num">{inn ? formatPeso(inn) : ""}</td>
                      <td className="num">{out ? formatPeso(out) : ""}</td>
                      <td className="num strong">{formatPeso(r.runningBalance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint small" style={{ marginTop: 12 }}>
          Voided items are hidden from balances. Click a number to open the source record.
        </p>
      </div>
    </>
  );
}
