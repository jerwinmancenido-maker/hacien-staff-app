// Approval inbox — pure decision helpers (no DB). The inbox is a surface
// over the existing approval flows; these mirror the document pages' own
// rules so a row never offers an action the document page would refuse.

import { COST_NOT_SET_LABEL } from "@/lib/quotes/calc";
import { approverError, poNeedsApproval } from "@/lib/purchasing/status";

/**
 * Which of a quote's approval reasons this viewer may see. Mirrors the
 * quote page (approvalFromSnap in quotes/views.ts): cost-based reasons
 * are hidden from viewers without cost access — a "Cost not set" reason
 * must not leak — and `hidden` tells the UI a reason exists but is not
 * shown, so an empty visible list never reads as a clean quote.
 */
export function visibleApprovalReasons(
  reasons: readonly string[],
  withCosts: boolean,
): { reasons: string[]; hidden: boolean } {
  if (withCosts) return { reasons: [...reasons], hidden: false };
  const visible = reasons.filter((r) => r !== COST_NOT_SET_LABEL);
  return { reasons: visible, hidden: visible.length !== reasons.length };
}

/**
 * A DRAFT PO waits for approval only when its subtotal is strictly above
 * the approval limit in its PINNED settings version (mirrors
 * purchasing/views.ts). A missing pin fails closed: the PO waits.
 */
export function poWaitsForApproval(subtotal: string, pinnedPoTotalAbove: number | null): boolean {
  if (pinnedPoTotalAbove === null) return true;
  return poNeedsApproval(subtotal, pinnedPoTotalAbove);
}

/**
 * Why this viewer cannot approve this PO, or null when they can. The
 * self-approval rule itself (an Approver may not approve their own PO;
 * an Admin may) lives in purchasing/status.ts — this is the inbox's
 * handle on it, shared with the row rendering.
 */
export function poApproveBlockedReason(
  viewer: { id: string; isAdmin?: boolean },
  createdById: string,
): string | null {
  return approverError(viewer, createdById);
}
