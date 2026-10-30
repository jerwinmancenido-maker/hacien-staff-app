import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { money, ymd } from "@/lib/documents/common";
import { getExpense } from "@/lib/services/expenses";
import { Activity } from "@/components/Activity";
import { CashNav } from "@/components/cash/CashNav";
import { CASH_DISCLAIMER, ExpenseStatusChip } from "@/components/cash/CashParts";
import { VoidButton } from "@/components/purchasing/DocButtons";
import { PillTabs } from "@/components/PillTabs";
import { PageHeader } from "@/components/ui";
import { voidExpenseAction } from "../../actions";

const day = (ymdStr: string | null) => (ymdStr ? formatDate(new Date(`${ymdStr}T00:00:00.000Z`)) : "—");

export default async function ExpenseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: raw } = await searchParams;
  const tab = raw === "attachments" ? raw : "overview";
  const e = await getExpense(id);
  if (!e) notFound();
  const canManage = can(user, "manage_cash");
  const canVoid = canManage && e.status === "POSTED";
  const payee = e.supplier?.name ?? e.payeeText ?? "—";

  return (
    <>
      <PageHeader
        title={
          <>
            {e.number}
            <ExpenseStatusChip status={e.status} />
          </>
        }
        subtitle={`${payee} · ${CASH_DISCLAIMER}`}
        actions={
          canVoid && (
            <VoidButton
              label="Void expense"
              docLabel={`expense ${e.number}`}
              body="Voiding removes this expense from the account balance. Give a short reason. The expense number stays used and is never reused."
              onVoid={voidExpenseAction.bind(null, id)}
            />
          )
        }
      />
      <CashNav active="expenses" />
      {e.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {e.voidReason}
        </div>
      )}

      <div className="detail-grid">
        <div className="card">
          <dl className="kv kv-grid">
            <dt>Date</dt>
            <dd>{day(ymd(e.date))}</dd>
            <dt>Payee</dt>
            <dd>
              {e.supplier ? <Link href={`/suppliers/${e.supplier.id}`}>{e.supplier.name}</Link> : e.payeeText}
            </dd>
            <dt>Category</dt>
            <dd>{e.category.label}</dd>
            <dt>Paid from</dt>
            <dd>
              <Link href={`/cash/accounts/${e.cashAccount.id}`}>{e.cashAccount.name}</Link>
            </dd>
            <dt>Amount</dt>
            <dd className="num strong">{formatPeso(money(e.amount))}</dd>
            {Number(money(e.withholdingApplied)) > 0 && (
              <>
                <dt>
                  Withholding (EWT)
                  <div className="hint">Record only — does not change cash leaving the account</div>
                </dt>
                <dd className="num">{formatPeso(money(e.withholdingApplied))}</dd>
              </>
            )}
            <dt>OR / receipt no.</dt>
            <dd>{e.receiptNo ?? "—"}</dd>
            {e.notes && (
              <>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{e.notes}</dd>
              </>
            )}
          </dl>
        </div>
        <Activity targets={[{ entityType: "Expense", ids: [id] }]} viewer={user} />
      </div>

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/cash/expenses/${id}` },
          { key: "attachments", label: "Attachments", count: e.attachments.length, href: `/cash/expenses/${id}?tab=attachments` },
        ]}
      />

      {tab === "overview" && (
        <div className="card">
          <p className="faint small">
            Key status and amounts are at the top. This expense is in the{" "}
            <Link href={`/cash/ledger?accountId=${e.cashAccountId}`}>ledger for {e.cashAccount.name}</Link>.
          </p>
        </div>
      )}

      {tab === "attachments" && (
        <div className="card">
          {e.attachments.length === 0 ? (
            <p className="faint">No receipt attachments.</p>
          ) : (
            <ul className="plain-list">
              {e.attachments.map((a) => (
                <li key={a.id}>
                  <a href={`/files/attachments/${a.id}`}>{a.fileName}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
