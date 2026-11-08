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

/** What a draft save should do next. Same order as Mark as sent: cost warning wins over the withholding question. */
export type QuoteSaveGate = "cost-warning" | "withholding-unset" | "save";

/**
 * S-79: Save draft (and Submit for approval — the same save action: a new
 * quote is created PENDING, and an edit save resets approval to PENDING) asks
 * "No withholding on this quote?" when no pick is set, exactly like Mark as sent.
 * Approval is not a gate here: saving is what submits the quote for approval.
 */
/**
 * Whether the quote record header shows the status chip next to the
 * workflow approval chip. An approved quote that was never sent is still
 * DRAFT, and the two pills side by side ("Draft" + "Approved") read as a
 * contradiction — the approval chip alone carries the state until the
 * status moves on (2026-11-08, test-3 friction A2).
 */
export function quoteHeaderShowsStatusChip(status: string, approvalStatus: string): boolean {
  return !(status === "DRAFT" && approvalStatus === "APPROVED");
}

export function quoteSaveGate(input: {
  withholdingUnset: boolean;
  supplierCostMissing: boolean;
}): QuoteSaveGate {
  if (input.supplierCostMissing) return "cost-warning";
  if (input.withholdingUnset) return "withholding-unset";
  return "save";
}

/** What Mark as sent should do next. Cost warning wins over the withholding question. */
export type QuoteMarkSentGate = "need-approval" | "cost-warning" | "withholding-unset" | "send";

/**
 * Mark as sent with withholding still unset must still warn when a supplier
 * cost is missing, and must not send while approval is still required.
 */
export function quoteMarkSentGate(input: {
  approved: boolean;
  withholdingUnset: boolean;
  supplierCostMissing: boolean;
}): QuoteMarkSentGate {
  if (!input.approved) return "need-approval";
  if (input.supplierCostMissing) return "cost-warning";
  if (input.withholdingUnset) return "withholding-unset";
  return "send";
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
