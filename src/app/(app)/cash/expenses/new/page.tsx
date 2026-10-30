import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { isoDate, manilaToday } from "@/lib/format";
import { CASH_ACCOUNT_TYPE_LABELS } from "@/lib/cash/labels";
import { defaultCashAccountId, listActiveCashAccounts } from "@/lib/services/cash-accounts";
import { defaultExpenseCategoryId, listExpenseCategories } from "@/lib/services/expenses";
import { CashNav } from "@/components/cash/CashNav";
import { ExpenseForm } from "@/components/cash/ExpenseForm";
import { CASH_DISCLAIMER } from "@/components/cash/CashParts";
import { PageHeader } from "@/components/ui";
import { recordExpenseAction } from "../../actions";

export default async function NewExpensePage() {
  const user = await requirePagePermission("view");
  if (!can(user, "manage_cash")) redirect("/no-access");

  const [accounts, categories, suppliers, defaultAccount, defaultCategory] = await Promise.all([
    listActiveCashAccounts(),
    listExpenseCategories(true),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    defaultCashAccountId(),
    defaultExpenseCategoryId(),
  ]);
  const today = isoDate(manilaToday());

  return (
    <>
      <PageHeader title="Record expense" subtitle={CASH_DISCLAIMER} />
      <CashNav active="expenses" />
      <div className="card" style={{ maxWidth: 800 }}>
        <ExpenseForm
          action={recordExpenseAction}
          canEdit
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            typeLabel: CASH_ACCOUNT_TYPE_LABELS[a.type],
            hint: a.accountHintLast4,
          }))}
          categories={categories.map((c) => ({ id: c.id, label: c.label }))}
          suppliers={suppliers}
          defaults={{
            date: today,
            supplierId: "",
            payeeText: "",
            categoryId: defaultCategory ?? categories[0]?.id ?? "",
            amount: "",
            withholdingApplied: "0",
            cashAccountId: defaultAccount ?? accounts[0]?.id ?? "",
            receiptNo: "",
            notes: "",
          }}
        />
      </div>
    </>
  );
}
