"use client";

// Top-right of the PO page: the next step as the primary button, plus
// Actions ▾ (Edit, Print / Save PDF, Email, Receive, Return items, Record bill, Close, Void).
// The server re-checks every action (permission, cost access, status).

import { useState, useTransition } from "react";
import { ActionsMenu, type MenuItem } from "@/components/docs/ActionsMenu";
import { EmailDialog, VoidDialog, type EmailDraftView } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";
import { CloseDialog } from "./DocButtons";

type Props = {
  id: string;
  number: string;
  status: string;
  canEdit: boolean;
  /** Admin only. Staff and Approver do not see Edit. */
  canMaintain: boolean;
  /** Admin or Approver. */
  canVoid: boolean;
  canApprove: boolean;
  approveBlockedReason: string | null;
  /** S-18: Draft under/at the PO limit may mark sent without approval. */
  canMarkSentFromDraft?: boolean;
  postedReceipts: number;
  actions: {
    approve: (id: string) => Promise<FormState>;
    markSent: (id: string) => Promise<FormState>;
    close: (id: string, reason: string) => Promise<FormState>;
    void: (id: string, reason: string) => Promise<FormState>;
    email: (id: string) => Promise<FormState & { draft?: EmailDraftView }>;
  };
};

export function PoActions({
  id,
  number,
  status,
  canEdit,
  canMaintain,
  canVoid,
  canApprove,
  approveBlockedReason,
  canMarkSentFromDraft = false,
  postedReceipts,
  actions,
}: Props) {
  const [dialog, setDialog] = useState<"void" | "close" | null>(null);
  const [draft, setDraft] = useState<EmailDraftView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const run = (fn: () => Promise<FormState & { draft?: EmailDraftView }>) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? null : (res.message ?? res.fieldErrors?.reason ?? "Something went wrong."));
      if (res.draft) setDraft(res.draft);
    });

  const editable = status === "DRAFT" || status === "APPROVED";
  const receivable = status === "SENT" || status === "PARTIALLY_RECEIVED";
  const items: MenuItem[] = [];
  if (canMaintain && editable) items.push({ key: "edit", label: status === "APPROVED" ? "Edit (returns to Draft)" : "Edit", href: `/purchase-orders/${id}/edit` });
  items.push({ key: "print", label: "Print / Save PDF", href: `/print/purchase-orders/${id}`, newTab: true });
  if (canEdit && ((status !== "DRAFT" && status !== "VOID") || canMarkSentFromDraft) && status !== "VOID") {
    items.push({ key: "email", label: "Email draft", onSelect: () => run(() => actions.email(id)) });
  }
  if (canEdit && receivable) items.push({ key: "receive", label: "Receive items", href: `/receiving/${id}/new` });
  if (canEdit && ["SENT", "PARTIALLY_RECEIVED", "RECEIVED"].includes(status)) items.push({ key: "return", label: "Return items", href: `/purchase-orders/${id}/returns/new` });
  if (canEdit && ["SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(status)) items.push({ key: "bill", label: "Record supplier bill", href: `/purchase-orders/${id}/bill` });
  if (canEdit && (status === "PARTIALLY_RECEIVED" || status === "RECEIVED")) items.push({ key: "close", label: status === "PARTIALLY_RECEIVED" ? "Short-close" : "Close", onSelect: () => setDialog("close") });
  if (canVoid && ["DRAFT", "APPROVED", "SENT"].includes(status) && postedReceipts === 0) items.push({ key: "void", label: "Void", danger: true, onSelect: () => setDialog("void") });

  // S-66: no separate blue main button beside the Actions menu. The
  // workflow actions that used to sit there are menu items below, with
  // the same gates; Receive items and Close PO were already menu items,
  // so their duplicate buttons are gone. Approve PO only appears when
  // it can actually be approved — the blocked-reason note on the page
  // still explains a wait.
  if (canEdit && status === "DRAFT" && canMarkSentFromDraft) items.push({ key: "mark-sent", label: "Mark as sent", onSelect: () => run(() => actions.markSent(id)) });
  else if (status === "DRAFT" && canApprove) items.push({ key: "approve", label: "Approve PO", onSelect: () => run(() => actions.approve(id)) });
  else if (canEdit && status === "APPROVED") items.push({ key: "mark-sent", label: "Mark as sent", onSelect: () => run(() => actions.markSent(id)) });

  return (
    <>
      {message && (
        <span role="alert" className="small" style={{ color: "var(--red)" }}>
          {message}
        </span>
      )}
      {status === "DRAFT" && approveBlockedReason && (
        <span className="small muted" role="note">
          {approveBlockedReason}
        </span>
      )}
      <ActionsMenu items={items} />
      {dialog === "void" && (
        <VoidDialog
          docLabel="PO"
          body={`${number} will be marked Void and become read-only. Its sales order lines are freed so they can go on a new PO. The number is kept and never reused.`}
          onClose={() => setDialog(null)}
          onVoid={(reason) => actions.void(id, reason)}
        />
      )}
      {dialog === "close" && (
        <CloseDialog number={number} needsReason={status === "PARTIALLY_RECEIVED"} onClose={() => setDialog(null)} onConfirm={(reason) => actions.close(id, reason)} />
      )}
      {draft && <EmailDialog draft={draft} onClose={() => setDraft(null)} />}
    </>
  );
}
