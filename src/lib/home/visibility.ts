// Pure helpers for what the Home dashboard shows. No DB — unit-tested.

import { can, canSeeCosts, type PermissionUser } from "../permissions";

export type HomeActionKind =
  | "quotesNeedsApproval"
  | "quotesNoReply"
  | "salesOrdersNeedsPo"
  | "posAwaitingReceipt"
  | "billsOverPo"
  | "billingsOverdue"
  | "customersNoWithholding";

export type HomeMoneyKind =
  | "owedByCustomers"
  | "collectedThisMonth"
  | "supplierBillsDueSoon";

/** Action rows that need the "Can see costs" flag (supplier cost / PO totals). */
export const COST_ACTION_KINDS: readonly HomeActionKind[] = ["billsOverPo"];

/** Money figures that are supplier-cost / payable data. */
export const COST_MONEY_KINDS: readonly HomeMoneyKind[] = ["supplierBillsDueSoon"];

export type HomeFeatureFlags = {
  payablesEnabled: boolean;
  cashEnabled: boolean;
  booksEnabled: boolean;
};

/** Supplier bills due soon only when Payables or Cash is on. */
export function showSupplierBillsDueSoon(flags: HomeFeatureFlags): boolean {
  return flags.payablesEnabled || flags.cashEnabled;
}

/** Tax calendar card: Books on and the viewer may open Books. */
export function showTaxDeadline(flags: HomeFeatureFlags, user: PermissionUser): boolean {
  return flags.booksEnabled && can(user, "view_books");
}

export function canShowActionRow(kind: HomeActionKind, count: number, user: PermissionUser): boolean {
  if (count <= 0) return false;
  if (COST_ACTION_KINDS.includes(kind) && !canSeeCosts(user)) return false;
  return true;
}

export function canShowMoneyFigure(
  kind: HomeMoneyKind,
  user: PermissionUser,
  flags: HomeFeatureFlags,
): boolean {
  if (kind === "supplierBillsDueSoon") {
    if (!showSupplierBillsDueSoon(flags)) return false;
    if (!canSeeCosts(user)) return false;
  }
  return true;
}

/** Empty Home: no customers yet → getting-started card instead of sections. */
export function isHomeEmpty(customerCount: number): boolean {
  return customerCount <= 0;
}
