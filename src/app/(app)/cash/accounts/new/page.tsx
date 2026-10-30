import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { isoDate, manilaToday } from "@/lib/format";
import { AccountForm } from "@/components/cash/AccountForm";
import { CashNav } from "@/components/cash/CashNav";
import { CASH_DISCLAIMER } from "@/components/cash/CashParts";
import { PageHeader } from "@/components/ui";
import { createCashAccountAction } from "../../actions";

export default async function NewCashAccountPage() {
  const user = await requirePagePermission("view");
  if (!can(user, "manage_cash")) redirect("/no-access");
  const today = isoDate(manilaToday());

  return (
    <>
      <PageHeader title="Add cash account" subtitle={CASH_DISCLAIMER} />
      <CashNav active="accounts" />
      <div className="card" style={{ maxWidth: 720 }}>
        <AccountForm
          action={createCashAccountAction}
          canEdit
          mode="create"
          defaults={{
            name: "",
            type: "BANK",
            bankName: "",
            accountHintLast4: "",
            openingBalance: "0.00",
            openingDate: today,
            active: true,
          }}
        />
      </div>
    </>
  );
}
