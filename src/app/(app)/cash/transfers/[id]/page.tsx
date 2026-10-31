import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { money, ymd } from "@/lib/documents/common";
import { getCashTransfer } from "@/lib/services/cash-transfers";
import { Activity } from "@/components/Activity";
import { CashNav } from "@/components/cash/CashNav";
import { CASH_DISCLAIMER, TransferStatusChip } from "@/components/cash/CashParts";
import { VoidButton } from "@/components/purchasing/DocButtons";
import { PageHeader } from "@/components/ui";
import { voidCashTransferAction } from "../../actions";

const day = (ymdStr: string | null) => (ymdStr ? formatDate(new Date(`${ymdStr}T00:00:00.000Z`)) : "—");

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const t = await getCashTransfer(id);
  if (!t) notFound();
  const canManage = can(user, "manage_cash");
  const canVoid = canManage && t.status === "POSTED";

  return (
    <>
      <PageHeader
        title={
          <>
            {t.number}
            <TransferStatusChip status={t.status} />
          </>
        }
        subtitle={CASH_DISCLAIMER}
        actions={
          canVoid && (
            <VoidButton
              label="Void transfer"
              docLabel={`transfer ${t.number}`}
              body="Voiding puts both account balances back. Give a short reason. The transfer number stays used."
              onVoid={voidCashTransferAction.bind(null, id)}
            />
          )
        }
      />
      <CashNav active="transfers" />
      {t.status === "VOID" && (
        <div className="alert error" role="status">
          <b>Void.</b> {t.voidReason}
        </div>
      )}
      <div className="detail-grid">
        <div className="card">
          <dl className="kv kv-grid">
            <dt>Date</dt>
            <dd>{day(ymd(t.date))}</dd>
            <dt>From</dt>
            <dd>
              <Link href={`/cash/accounts/${t.fromAccount.id}`}>{t.fromAccount.name}</Link>
            </dd>
            <dt>To</dt>
            <dd>
              <Link href={`/cash/accounts/${t.toAccount.id}`}>{t.toAccount.name}</Link>
            </dd>
            <dt>Amount</dt>
            <dd className="num strong">{formatPeso(money(t.amount))}</dd>
            {t.notes && (
              <>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{t.notes}</dd>
              </>
            )}
          </dl>
        </div>
        <Activity targets={[{ entityType: "CashTransfer", ids: [id] }]} viewer={user} />
      </div>
    </>
  );
}
