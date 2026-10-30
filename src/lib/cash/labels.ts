import type { CashAccountType, CashTransferStatus, ExpenseStatus } from "@prisma/client";

export const CASH_ACCOUNT_TYPES = ["CASH_ON_HAND", "BANK", "E_WALLET"] as const;
export type CashAccountTypeInput = (typeof CASH_ACCOUNT_TYPES)[number];

export const CASH_ACCOUNT_TYPE_LABELS: Record<CashAccountType, string> = {
  CASH_ON_HAND: "Cash on hand",
  BANK: "Bank account",
  E_WALLET: "E-wallet",
};

export const CASH_ACCOUNT_TYPE_HINTS: Record<CashAccountType, string> = {
  CASH_ON_HAND: "Petty cash or bills kept in the office.",
  BANK: "A bank account you track by hand (no bank connection).",
  E_WALLET: "GCash, Maya, or similar.",
};

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  POSTED: "Posted",
  VOID: "Void",
};

export const TRANSFER_STATUS_LABELS: Record<CashTransferStatus, string> = {
  POSTED: "Posted",
  VOID: "Void",
};

export const CASH_DISCLAIMER = "Hand-recorded only — the app never connects to a bank.";
