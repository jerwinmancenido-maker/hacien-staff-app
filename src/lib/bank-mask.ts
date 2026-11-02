// Masking for supplier bank account numbers.
// Page, list, print, and edit payloads are always last-4 only ("•••• 1234"),
// including for Admins. The full number is returned only by
// revealSupplierBankAccount, which writes an activity log (last 4, never the
// full number). Only an active Admin can reveal or edit bank details.

import type { PermissionUser } from "./permissions";

export const BANK_MASK_PREFIX = "••••";

/** True when the value is already a masked display, not a stored account number. */
export function isMaskedBankAccountNumber(value?: string | null): boolean {
  if (!value || !value.trim()) return false;
  return value.trim().startsWith(BANK_MASK_PREFIX);
}

/**
 * Mask a bank account number showing last 4 only: "•••• 1234".
 * Null, undefined, or empty/whitespace string returns "".
 * Already-masked values are returned unchanged (short numbers stay intact).
 */
export function maskBankAccountNumber(value?: string | null): string {
  if (!value || !value.trim()) return "";
  const trimmed = value.trim();
  if (isMaskedBankAccountNumber(trimmed)) return trimmed;
  const last4 = trimmed.slice(-4);
  return `${BANK_MASK_PREFIX} ${last4}`;
}

/**
 * Edit field draft. Never preloads the stored number (full or masked).
 * A number the Admin just typed is kept so a validation error can redisplay it.
 */
export function bankNumberDraft(echoed?: string | null): string {
  const typed = echoed?.trim() ?? "";
  if (!typed || isMaskedBankAccountNumber(typed)) return "";
  return typed;
}

/**
 * Blank or a masked display keeps the stored number. A newly typed number
 * replaces it. The mask itself is never persisted.
 */
export function resolveBankAccountNumber(
  submitted: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  const raw = submitted?.trim() ?? "";
  if (!raw || isMaskedBankAccountNumber(raw)) {
    const kept = existing?.trim() ?? "";
    return kept ? kept : null;
  }
  return raw;
}

/**
 * Activity row for an Admin reveal. A raw number stored by mistake is not shown.
 */
export function bankViewActivityLabel(after: unknown): string | null {
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const row = after as Record<string, unknown>;
  if (row.action !== "viewed bank number") return null;
  const masked =
    typeof row.bankAccountNumber === "string" && isMaskedBankAccountNumber(row.bankAccountNumber)
      ? row.bankAccountNumber.trim()
      : "";
  return masked ? `viewed bank number ${masked}` : "viewed bank number";
}

/**
 * Extract last 4 characters of a bank account number, or "" if empty.
 */
export function extractLast4(value?: string | null): string {
  if (!value || !value.trim()) return "";
  return value.trim().slice(-4);
}

function maskedSupplier<T extends { bankAccountNumber?: string | null }>(supplier: T): T {
  return {
    ...supplier,
    bankAccountNumber: maskBankAccountNumber(supplier.bankAccountNumber),
  };
}

/**
 * Mask supplier bank details before they leave the server.
 * Active Admins do not receive the full number here; they use the logged reveal.
 */
export function maskSupplierForViewer<T extends { bankAccountNumber?: string | null }>(
  supplier: T,
  user?: PermissionUser | { isAdmin?: boolean; active?: boolean } | null,
): T {
  void user;
  return maskedSupplier(supplier);
}

/** Mask a list of suppliers before it leaves the server. Same rule as a single record. */
export function maskSuppliersForViewer<T extends { bankAccountNumber?: string | null }>(
  suppliers: T[],
  user?: PermissionUser | { isAdmin?: boolean; active?: boolean } | null,
): T[] {
  void user;
  return suppliers.map((s) => maskedSupplier(s));
}
