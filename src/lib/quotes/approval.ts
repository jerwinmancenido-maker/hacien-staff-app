// Quote workflow approval (S-18). Pure helpers — services call these; UI mirrors them.
// Orthogonal to QuoteStatus (DRAFT/SENT/WON/LOST/VOID).

import type { QuoteStatus } from "@prisma/client";
import { toScaled } from "./calc";

export type QuoteApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export const QUOTE_APPROVAL_STATUSES: QuoteApprovalStatus[] = ["PENDING", "APPROVED", "REJECTED"];

export const QUOTE_APPROVAL_LABELS: Record<QuoteApprovalStatus, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/**
 * Migration backfill: DRAFT → PENDING; any non-draft (SENT/WON/LOST/VOID) → APPROVED
 * with null approver fields (no invented history).
 */
export function quoteApprovalBackfill(status: QuoteStatus): QuoteApprovalStatus {
  return status === "DRAFT" ? "PENDING" : "APPROVED";
}

/** Error if send / email / convert is blocked by approval state, else null. */
export function quoteNotApprovedError(approvalStatus: QuoteApprovalStatus): string | null {
  if (approvalStatus === "APPROVED") return null;
  if (approvalStatus === "REJECTED") return "This quote was rejected. Fix it and wait for approval before sending or converting.";
  return "This quote is waiting for approval. An Approver or Admin must approve it before sending or converting.";
}

/** Line money fields compared when deciding whether an edit clears approval. */
export type QuoteMoneyLine = {
  id: string | null;
  qty: string;
  unitPrice: string;
  total: string;
  supplierUnitCost: string;
  supplierTotal: string;
  withholdingRate: string | null;
  withholdingAtc: string | null;
};

export type QuoteMoneySnapshot = {
  contractPrice: string;
  withholdingTotal: string;
  netReceived: string;
  supplierCost: string;
  netMargin: string;
  netMarginPct: string;
  /** Stable fingerprint of document withholding (codes + rates). */
  withholdingKey: string;
  items: readonly QuoteMoneyLine[];
};

function scaledEq(a: string, b: string, dp = 2): boolean {
  return toScaled(a, dp) === toScaled(b, dp);
}

/**
 * True when price, qty, costs, withholding, or document/line totals changed
 * (resets APPROVED/REJECTED → PENDING). Match existing lines by id so reordering
 * alone does not clear approval; new or removed lines still count.
 */
export function quoteMoneyFieldsChanged(before: QuoteMoneySnapshot, after: QuoteMoneySnapshot): boolean {
  if (!scaledEq(before.contractPrice, after.contractPrice)) return true;
  if (!scaledEq(before.withholdingTotal, after.withholdingTotal)) return true;
  if (!scaledEq(before.netReceived, after.netReceived)) return true;
  if (!scaledEq(before.supplierCost, after.supplierCost)) return true;
  if (!scaledEq(before.netMargin, after.netMargin)) return true;
  if (!scaledEq(before.netMarginPct, after.netMarginPct)) return true;
  if (before.withholdingKey !== after.withholdingKey) return true;

  const beforeById = new Map(before.items.filter((i) => i.id).map((i) => [i.id!, i]));
  const afterById = new Map(after.items.filter((i) => i.id).map((i) => [i.id!, i]));
  if (beforeById.size !== afterById.size) return true;
  // New lines (null id) always count as a money change.
  if (after.items.some((i) => !i.id)) return true;
  if (before.items.length !== after.items.length) return true;

  for (const [id, a] of beforeById) {
    const b = afterById.get(id);
    if (!b) return true;
    if (!scaledEq(a.qty, b.qty)) return true;
    if (!scaledEq(a.unitPrice, b.unitPrice)) return true;
    if (!scaledEq(a.total, b.total)) return true;
    if (!scaledEq(a.supplierUnitCost, b.supplierUnitCost)) return true;
    if (!scaledEq(a.supplierTotal, b.supplierTotal)) return true;
    if ((a.withholdingRate ?? "") !== (b.withholdingRate ?? "")) return true;
    if ((a.withholdingAtc ?? "") !== (b.withholdingAtc ?? "")) return true;
  }
  return false;
}

/** Clear active approval/reject fields when money edits reset to PENDING. */
export function quoteApprovalClearData() {
  return {
    approvalStatus: "PENDING" as const,
    approvedById: null,
    approvedAt: null,
    rejectedById: null,
    rejectedAt: null,
    rejectReason: null,
  };
}
