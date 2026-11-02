// Masking and role-based protection for supplier bank account numbers.
// Non-Admins (Staff, Approver, Viewer) only see masked numbers ("•••• 1234").
// Only Admins can view the full number (via explicit reveal) or add/edit bank details.

import type { PermissionUser } from "./permissions";

export const BANK_MASK_PREFIX = "••••";

/**
 * Mask a bank account number showing last 4 only: "•••• 1234".
 * Null, undefined, or empty/whitespace string returns "".
 */
export function maskBankAccountNumber(value?: string | null): string {
  if (!value || !value.trim()) return "";
  const trimmed = value.trim();
  const last4 = trimmed.slice(-4);
  return `${BANK_MASK_PREFIX} ${last4}`;
}

/**
 * Extract last 4 characters of a bank account number, or "" if empty.
 */
export function extractLast4(value?: string | null): string {
  if (!value || !value.trim()) return "";
  return value.trim().slice(-4);
}

/**
 * Mask supplier bank details for non-Admins before data leaves the server.
 * Full number is never sent to non-Admin clients.
 */
export function maskSupplierForViewer<T extends { bankAccountNumber?: string | null }>(
  supplier: T,
  user?: PermissionUser | { isAdmin?: boolean; active?: boolean } | null,
): T {
  if (user && user.active !== false && user.isAdmin) {
    return supplier;
  }
  return {
    ...supplier,
    bankAccountNumber: maskBankAccountNumber(supplier.bankAccountNumber),
  };
}

/**
 * Mask an array of suppliers for non-Admins.
 */
export function maskSuppliersForViewer<T extends { bankAccountNumber?: string | null }>(
  suppliers: T[],
  user?: PermissionUser | { isAdmin?: boolean; active?: boolean } | null,
): T[] {
  if (user && user.active !== false && user.isAdmin) {
    return suppliers;
  }
  return suppliers.map((s) => ({
    ...s,
    bankAccountNumber: maskBankAccountNumber(s.bankAccountNumber),
  }));
}
