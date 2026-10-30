// How receiving account numbers appear on quotes, SOs and billings.
// Default: last 4 only. Full number only when the per-account toggle is ON
// and staff entered a full number. Never log the full value.

export type PaymentAccountForPrint = {
  accountLast4: string;
  printFullAccountNumber?: boolean;
  accountNumberFull?: string | null;
};

/** Masked last-4 form used when the full-number toggle is OFF (or no full number). */
export function maskAccountLast4(last4: string): string {
  return `****${last4}`;
}

/**
 * Value printed on customer-facing payment instructions.
 * Full number is returned only when both the toggle is on and a non-empty full number exists.
 */
export function accountNumberForPrint(account: PaymentAccountForPrint): string {
  const last4 = (account.accountLast4 ?? "").trim();
  const full = (account.accountNumberFull ?? "").trim();
  if (account.printFullAccountNumber && full) return full;
  return maskAccountLast4(last4);
}

/** Redact full account numbers from a print-settings value before logging / changelog. */
export function redactPrintAccountNumbers<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const v = value as { banks?: unknown; eWallets?: unknown };
  if (!Array.isArray(v.banks) && !Array.isArray(v.eWallets)) return value;
  const redactRow = (row: unknown) => {
    if (!row || typeof row !== "object") return row;
    const r = row as Record<string, unknown>;
    if (!r.accountNumberFull) return row;
    return { ...r, accountNumberFull: "[redacted]" };
  };
  return {
    ...(value as object),
    banks: Array.isArray(v.banks) ? v.banks.map(redactRow) : v.banks,
    eWallets: Array.isArray(v.eWallets) ? v.eWallets.map(redactRow) : v.eWallets,
  } as T;
}
