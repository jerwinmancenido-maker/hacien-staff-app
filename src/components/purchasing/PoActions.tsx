"use client";

// Top-right of the PO page: the next step as the primary button, plus
// Actions ▾ (Edit, Print / Save PDF, Email, Receive, Record bill, Close, Void).
// The server re-checks every action (permission, cost access, status).

import { useState, useTransition } from "react";
import Link from "next/link";
import { ActionsMenu, type MenuItem } from "@/components/docs/ActionsMenu";
import { EmailDialog, VoidDialog, type EmailDraftView } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";
import { CloseDialog } from "./DocButtons";

type Props = {
  id: string;
  number: string;
  status: string;
  canEdit: boolean;
  canApprove: boolean;
  approveBlockedReason: string | null;
  postedReceipts: number;
  actions: {
    approve: (id: string) => Promise<FormState>;
    markSent: (id: string) => Promise<FormState>;
    close: (id: string, reason: string) => Promise<FormState>;
    void: (id: string, reason: string) => Promise<FormState>;
    email: (id: string) => Promise<FormState & { draft?: EmailDraftView }>;
  };
};

export function PoActions({ id, number, status, canEdit, canApprove, approveBlockedReason, postedReceipts, actions }: Props) {
  const [dialog, setDialog] = useState<"void" | "close" | null>(null);
  const [draft, setDraft] = useState<EmailDraftView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<FormState & { draft?: EmailDraftView }>) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? null : (res.message ?? res.fieldErrors?.reason ?? "Something went wrong."));
      if (res.draft) setDraft(res.draft);
    });

  const editable = status === "DRAFT" || status === "APPROVED";
  const receivable = status === "SENT" || status === "PARTIALLY_RECEIVED";
  const items: MenuItem[] = [];
  if (canEdit && editable) items.push({ key: "edit", label: status === "APPROVED" ? "Edit (returns to Draft)" : "Edit", href: `/purchase-orders/${id}/edit` });
  items.push({ key: "print", label: "Print / Save PDF", href: `/print/purchase-orders/${id}`, newTab: true });
  if (canEdit && status !== "DRAFT" && status !== "VOID") items.push({ key: "email", label: "Email draft", onSelect: () => run(() => actions.email(id)) });
  if (canEdit && receivable) items.push({ key: "receive", label: "Receive items", href: `/receiving/${id}/new` });
  if (canEdit && ["SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(status)) items.push({ key: "bill", label: "Record supplier bill", href: `/purchase-orders/${id}/bill` });
  if (canEdit && (status === "PARTIALLY_RECEIVED" || status === "RECEIVED")) items.push({ key: "close", label: status === "PARTIALLY_RECEIVED" ? "Short-close" : "Close", onSelect: () => setDialog("close") });
  if (canEdit && ["DRAFT", "APPROVED", "SENT"].includes(status) && postedReceipts === 0) items.push({ key: "void", label: "Void", danger: true, onSelect: () => setDialog("void") });

  let primary: React.ReactNode = null;
  if (status === "DRAFT" && (canApprove || approveBlockedReason)) {
    primary = (
      <button type="button" className="btn" disabled={pending || !canApprove} title={approveBlockedReason ?? undefined} onClick={() => run(() => actions.approve(id))}>
        Approve PO
      </button>
    );
  } else if (canEdit && status === "APPROVED") {
    primary = (
      <button type="button" className="btn" disabled={pending} onClick={() => run(() => actions.markSent(id))}>
        Mark as sent
      </button>
    );
  } else if (canEdit && receivable) {
    primary = (
      <Link className="btn" href={`/receiving/${id}/new`}>
        Receive items
      </Link>
    );
  } else if (canEdit && status === "RECEIVED") {
    primary = (
      <button type="button" className="btn" onClick={() => setDialog("close")}>
        Close PO
      </button>
    );
  }

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
      {primary}
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
