import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { isoDate, manilaToday } from "@/lib/format";
import { CASH_ACCOUNT_TYPE_LABELS } from "@/lib/cash/labels";
import { defaultCashAccountId, listActiveCashAccounts } from "@/lib/services/cash-accounts";
import { CashNav } from "@/components/cash/CashNav";
import { TransferForm } from "@/components/cash/TransferForm";
import { CASH_DISCLAIMER } from "@/components/cash/CashParts";
import { PageHeader } from "@/components/ui";
import { recordCashTransferAction } from "../../actions";

export default async function NewTransferPage() {
  const user = await requirePagePermission("view");
  if (!can(user, "manage_cash")) redirect("/no-access");

  const accounts = await listActiveCashAccounts();
  const defaultFrom = await defaultCashAccountId();
  const toDefault = accounts.find((a) => a.id !== defaultFrom)?.id ?? accounts[1]?.id ?? "";
  const today = isoDate(manilaToday());

  return (
    <>
      <PageHeader title="Record transfer" subtitle={CASH_DISCLAIMER} />
      <CashNav active="transfers" />
      <div className="card" style={{ maxWidth: 720 }}>
        <TransferForm
          action={recordCashTransferAction}
          canEdit
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            typeLabel: CASH_ACCOUNT_TYPE_LABELS[a.type],
            hint: a.accountHintLast4,
          }))}
          defaults={{
            date: today,
            fromAccountId: defaultFrom ?? accounts[0]?.id ?? "",
            toAccountId: toDefault,
            amount: "",
            notes: "",
          }}
        />
      </div>
    </>
  );
}
