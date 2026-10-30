// Supplier PO status rules. Pure (no DB) so every transition can be tested.
//
//   DRAFT ──approve──▶ APPROVED ──mark sent──▶ SENT
//     ▲                   │                     │ receiving reports (automatic)
//     └──── edit ─────────┘                     ▼
//                               PARTIALLY_RECEIVED ⇄ RECEIVED ──close──▶ CLOSED
//                                         └──────── close (short-close, reason) ──▶ CLOSED
//   VOID (reason) from DRAFT / APPROVED / SENT, and only with no posted RR.

import type { ItemKind } from "../quotes/calc";
import { fromScaled, toScaled } from "../quotes/calc";

export type PoStatus = "DRAFT" | "APPROVED" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "VOID";

export const PO_STATUSES: PoStatus[] = ["DRAFT", "APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "VOID"];

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  SENT: "Sent",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CLOSED: "Closed",
  VOID: "Void",
};

export type PoAction = "edit" | "approve" | "markSent" | "receive" | "close" | "void" | "bill";

const ALLOWED: Record<PoAction, readonly PoStatus[]> = {
  edit: ["DRAFT", "APPROVED"],
  approve: ["DRAFT"],
  markSent: ["APPROVED"],
  receive: ["SENT", "PARTIALLY_RECEIVED"],
  close: ["PARTIALLY_RECEIVED", "RECEIVED"],
  void: ["DRAFT", "APPROVED", "SENT"],
  bill: ["SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"],
};

const MESSAGES: Record<PoAction, string> = {
  edit: "Only a draft or approved PO can be edited.",
  approve: "Only a draft PO can be approved.",
  markSent: "Approve the PO before marking it as sent.",
  receive: "Items can only be received on a sent or partially received PO.",
  close: "Only a partially or fully received PO can be closed.",
  void: "Only a draft, approved or sent PO can be voided.",
  bill: "Bills can be recorded once the PO is sent.",
};

export function canPo(status: PoStatus, action: PoAction): boolean {
  return ALLOWED[action].includes(status);
}

/** Error message for an action that isn't allowed in this status, or null. */
export function poActionError(status: PoStatus, action: PoAction): string | null {
  if (status === "VOID") return "This PO is void.";
  return canPo(status, action) ? null : MESSAGES[action];
}

/** Editing an approved PO sends it back to Draft (approval cleared, revision + 1). */
export function afterEdit(status: PoStatus): { status: PoStatus; clearsApproval: boolean } {
  return status === "APPROVED" ? { status: "DRAFT", clearsApproval: true } : { status, clearsApproval: false };
}

/** Approver must differ from the creator, unless the approver is an Admin. */
export function approverError(approver: { id: string; isAdmin: boolean }, createdById: string): string | null {
  if (approver.id === createdById && !approver.isAdmin) return "Someone other than the creator must approve this PO.";
  return null;
}

/** Short-closing a partially received PO needs a reason. */
export function closeError(status: PoStatus, reason: string | null | undefined): string | null {
  const e = poActionError(status, "close");
  if (e) return e;
  if (status === "PARTIALLY_RECEIVED" && !(reason ?? "").trim()) return "Give a reason for closing a partially received PO (short-close).";
  return null;
}

export function voidError(status: PoStatus, postedReceivingReports: number): string | null {
  const e = poActionError(status, "void");
  if (e) return e;
  if (postedReceivingReports > 0) return "Void the receiving reports first.";
  return null;
}

export type QtyLine = { qty: string; receivedQty: string };

/**
 * Status implied by received quantities, for a PO that is out for delivery
 * (SENT / PARTIALLY_RECEIVED / RECEIVED). Nothing received → SENT.
 */
export function receiptStatus(lines: readonly QtyLine[]): "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" {
  let any = false;
  let all = lines.length > 0;
  for (const l of lines) {
    const r = toScaled(l.receivedQty, 2);
    if (r > 0n) any = true;
    if (r < toScaled(l.qty, 2)) all = false;
  }
  if (all && any) return "RECEIVED";
  return any ? "PARTIALLY_RECEIVED" : "SENT";
}

export type ProgressState = "NOT_ORDERED" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED";

export const PROGRESS_LABELS: Record<ProgressState, string> = {
  NOT_ORDERED: "Not ordered",
  ORDERED: "Ordered",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
};

/** Purchasing progress of one sales order line, from its live PO lines. */
export function soLineProgress(soQty: string, poLines: readonly QtyLine[]): { state: ProgressState; ordered: string; received: string } {
  let ordered = 0n;
  let received = 0n;
  for (const l of poLines) {
    ordered += toScaled(l.qty, 2);
    received += toScaled(l.receivedQty, 2);
  }
  const need = toScaled(soQty, 2);
  let state: ProgressState = "NOT_ORDERED";
  if (poLines.length) state = received <= 0n ? "ORDERED" : received >= need && received >= ordered ? "RECEIVED" : "PARTIALLY_RECEIVED";
  return { state, ordered: fromScaled(ordered, 2), received: fromScaled(received, 2) };
}

export type { ItemKind };
