import { db, type Tx } from "../db";
import { DocRuleError, money } from "../documents/common";
import { cashAccountBalance } from "../services/cash-accounts";
import { formatPeso } from "../format";
import { fromScaled, toScaled } from "../quotes/calc";

/**
 * F37 — funds guard for money-out entries (Jerwin's call, 2026-11-20:
 * WARN, don't refuse). Transfers, expenses and supplier payments used to
 * validate only that the paying account exists and is active — a ₱999,999
 * transfer out of a ₱10,750 account saved silently (REQ-006 Block 9, J5).
 * Now: when the cash leaving an account exceeds what the account holds,
 * the form round-trips a warning ("…holds ₱X — this … takes it to −₱Y.
 * Record anyway?") and nothing is saved until the user confirms; the
 * services enforce the same rule for non-form callers via
 * `allowOverBalance`. Balances are the full POSTED balance — the same
 * math as cashAccountBalance and the F30 deactivation guard.
 */

export function fundsWarningSentence(
  accountLabel: string,
  balance: string,
  cashOut: string,
  noun: "transfer" | "expense" | "payment",
): string | null {
  const bal = toScaled(balance, 2);
  const out = toScaled(cashOut, 2);
  if (out <= bal) return null;
  const resulting = fromScaled(bal - out, 2);
  return `${accountLabel} holds ${formatPeso(balance)} — this ${noun} takes it to ${formatPeso(resulting)}. Record anyway?`;
}

type AccountRow = { id: string; name: string; openingBalance: unknown };

/** POSTED balance of one account, computed on the caller's transaction. */
export async function postedBalanceInTx(tx: Tx, account: AccountRow): Promise<string> {
  const id = account.id;
  const [colIn, payOut, expOut, trOut, trIn] = await Promise.all([
    tx.collection.aggregate({ where: { cashAccountId: id, status: "POSTED" }, _sum: { amountReceived: true } }),
    tx.supplierPayment.aggregate({ where: { cashAccountId: id, status: "POSTED" }, _sum: { amountPaid: true } }),
    tx.expense.aggregate({ where: { cashAccountId: id, status: "POSTED" }, _sum: { amount: true } }),
    tx.cashTransfer.aggregate({ where: { fromAccountId: id, status: "POSTED" }, _sum: { amount: true } }),
    tx.cashTransfer.aggregate({ where: { toAccountId: id, status: "POSTED" }, _sum: { amount: true } }),
  ]);
  const agg = (sum: Record<string, unknown> | null, key: string) =>
    toScaled(money((sum?.[key] ?? "0") as never), 2);
  const balance =
    toScaled(money(account.openingBalance as never), 2) +
    agg(colIn._sum as Record<string, unknown> | null, "amountReceived") -
    agg(payOut._sum as Record<string, unknown> | null, "amountPaid") -
    agg(expOut._sum as Record<string, unknown> | null, "amount") -
    agg(trOut._sum as Record<string, unknown> | null, "amount") +
    agg(trIn._sum as Record<string, unknown> | null, "amount");
  return fromScaled(balance, 2);
}

/**
 * Form-action pre-check: the same sentence, or null when the entry fits
 * the balance (or the account is missing/inactive — the service raises
 * the real error for those).
 */
export async function fundsWarning(
  accountId: string,
  cashOut: string,
  noun: "transfer" | "expense" | "payment",
): Promise<string | null> {
  const account = await db.cashAccount.findUnique({
    where: { id: accountId },
    select: { name: true, active: true },
  });
  if (!account || !account.active) return null;
  const balance = await cashAccountBalance(accountId);
  return fundsWarningSentence(account.name, balance, cashOut, noun);
}

/**
 * Service-side enforcement: throws the warning sentence as a DocRuleError
 * when the entry takes the account negative and the caller has not
 * confirmed. Form actions pre-check with the same sentence and return it
 * as a soft warning instead, so form users never see this throw.
 */
export async function assertFundsInTx(
  tx: Tx,
  account: AccountRow,
  cashOut: string,
  noun: "transfer" | "expense" | "payment",
  field: string,
  allowOverBalance?: boolean,
): Promise<void> {
  if (allowOverBalance) return;
  const balance = await postedBalanceInTx(tx, account);
  const warning = fundsWarningSentence(account.name, balance, cashOut, noun);
  if (warning) throw new DocRuleError(warning, field);
}
