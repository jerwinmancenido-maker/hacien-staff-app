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

/** True when price, qty, or document/line totals changed (resets approval). */
export function quoteMoneyFieldsChanged(
  before: { contractPrice: string; items: readonly { qty: string; unitPrice: string; total: string }[] },
  after: { contractPrice: string; items: readonly { qty: string; unitPrice: string; total: string }[] },
): boolean {
  if (toScaled(before.contractPrice, 2) !== toScaled(after.contractPrice, 2)) return true;
  if (before.items.length !== after.items.length) return true;
  for (let i = 0; i < before.items.length; i++) {
    const a = before.items[i]!;
    const b = after.items[i]!;
    if (toScaled(a.qty, 2) !== toScaled(b.qty, 2)) return true;
    if (toScaled(a.unitPrice, 2) !== toScaled(b.unitPrice, 2)) return true;
    if (toScaled(a.total, 2) !== toScaled(b.total, 2)) return true;
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
