import { Chip } from "@/components/ui";
import { CASH_ACCOUNT_TYPE_LABELS, CASH_DISCLAIMER, EXPENSE_STATUS_LABELS, TRANSFER_STATUS_LABELS } from "@/lib/cash/labels";
import type { CashAccountType, CashTransferStatus, ExpenseStatus } from "@prisma/client";

export { CASH_DISCLAIMER };

export function AccountTypeLabel({ type }: { type: CashAccountType }) {
  return <>{CASH_ACCOUNT_TYPE_LABELS[type]}</>;
}

export function ExpenseStatusChip({ status }: { status: ExpenseStatus }) {
  return <Chip tone={status === "VOID" ? "red" : "green"}>{EXPENSE_STATUS_LABELS[status]}</Chip>;
}

export function TransferStatusChip({ status }: { status: CashTransferStatus }) {
  return <Chip tone={status === "VOID" ? "red" : "green"}>{TRANSFER_STATUS_LABELS[status]}</Chip>;
}

export function AccountActiveChip({ active }: { active: boolean }) {
  return <Chip tone={active ? "green" : "grey"}>{active ? "Active" : "Inactive"}</Chip>;
}
