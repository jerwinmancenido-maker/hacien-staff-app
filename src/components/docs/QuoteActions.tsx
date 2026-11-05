"use client";

// Top-right of the quote page: every action lives in Actions ▾
// (S-66 — no separate blue main button; Approve, Reject, Mark as sent,
// Convert to SO and Open sales order are menu items).
// Viewers only get Print. The server re-checks every action.
//
// S-18: Mark as sent / Email / Convert stay hidden until workflow-approved.
// Approver/Admin get Approve / Reject while PENDING.
//
// When withholding is not set on a draft, Mark as sent asks
// "No withholding on this quote?" — Yes, none / Pick rates.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionsMenu, type MenuItem } from "./ActionsMenu";
import { ConvertDialog, EmailDialog, Modal, VoidDialog, type AddressOption, type EmailDraftView } from "./Dialogs";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { COST_NOT_SET_LABEL } from "@/lib/quotes/calc";
import { quoteMarkSentGate, quoteNotApprovedError } from "@/lib/quotes/approval";
import {
  WITHHOLDING_NONE_CONFIRM_PICK,
  WITHHOLDING_NONE_CONFIRM_TITLE,
  WITHHOLDING_NONE_CONFIRM_YES,
} from "@/lib/quotes/withholding-defaults";
import type { FormState } from "@/lib/validation/forms";

type Props = {
  id: string;
  number: string;
  status: string;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  canEdit: boolean;
  /** Admin or Approver. Staff keep Edit and do not see Void. */
  canVoid: boolean;
  canApproveWorkflow: boolean;
  /** An open sales order made from this quote, if any. */
  openSalesOrderId: string | null;
  /** Suggested delivery address (default delivery, else billing), editable in the dialog. */
  customerAddress: string;
  addressOptions?: AddressOption[];
  /** When true, Mark as sent shows the no-withholding confirm first. */
  withholdingNotSet?: boolean;
  /** Cost viewer, and at least one line has a blank or ₱0.00 supplier cost. */
  costMissing?: boolean;
  /** Audit: a conforme file is on file or acceptance is recorded. */
  hasAcceptance?: boolean;
  actions: {
    markSent: (id: string) => Promise<FormState>;
    /** Saves explicit none then marks sent (Yes, none). */
    confirmNoneAndMarkSent?: (id: string) => Promise<FormState>;
    markLost: (id: string) => Promise<FormState>;
    void: (id: string, reason: string) => Promise<FormState>;
    convert: (id: string, input: { buyerPoNo: string; buyerPoDate: string; deliveryAddressId: string; deliveryAddress?: string }) => Promise<FormState>;
    email: (id: string) => Promise<FormState & { draft?: EmailDraftView }>;
    /** Draft/unsent only — refresh letterhead from current settings. */
    refreshCompanyDetails?: (id: string) => Promise<FormState>;
    /** S-55: fresh draft copy, Rev 1. */
    duplicate?: (id: string) => Promise<FormState & { newQuoteId?: string }>;
    /** S-55: fresh draft copy with revision + 1 (sent/won quotes). */
    newRevision?: (id: string) => Promise<FormState & { newQuoteId?: string }>;
    approve?: (id: string) => Promise<FormState>;
    reject?: (id: string, reason: string) => Promise<FormState>;
  };
};

export function QuoteActions({
  id,
  number,
  status,
  approvalStatus,
  canEdit,
  canVoid,
  canApproveWorkflow,
  openSalesOrderId,
  customerAddress,
  addressOptions,
  withholdingNotSet = false,
  costMissing = false,
  hasAcceptance = false,
  actions,
}: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"void" | "convert" | "lost" | "wh-none" | "cost" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const rejectReasonRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<EmailDraftView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (dialog === "reject") rejectReasonRef.current?.focus();
  }, [dialog]);

  /** S-55: like run, but opens the new quote's edit page on success. */
  const runAndGo = (fn: () => Promise<FormState & { newQuoteId?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? null : (res.message ?? "Something went wrong."));
      setOkMessage(res.ok ? (res.message ?? null) : null);
      if (res.ok && res.newQuoteId) router.push(`/quotes/${res.newQuoteId}/edit`);
    });

  const run = (fn: () => Promise<FormState & { draft?: EmailDraftView }>) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? null : (res.message ?? res.fieldErrors?.reason ?? "Something went wrong."));
      setOkMessage(res.ok ? (res.message ?? null) : null);
      if (res.draft) setDraft(res.draft);
    });

  const approved = approvalStatus === "APPROVED";
  const editable = status === "DRAFT" || status === "SENT";
  // S-66: no separate blue main button beside the Actions menu. The
  // workflow actions that used to sit there (Approve, Reject, Mark as
  // sent, Open sales order) are menu items below; Convert to SO was
  // already a menu item, so its duplicate button is gone too.
  /** Sent / WON / LOST / VOID keep a frozen company snapshot. */
  const canRefreshCompany = canEdit && status === "DRAFT" && !!actions.refreshCompanyDetails;
  const items: MenuItem[] = [];
  if (canEdit && editable) items.push({ key: "edit", label: "Edit", href: `/quotes/${id}/edit` });
  if (canEdit && status !== "VOID" && actions.duplicate) {
    items.push({
      key: "duplicate",
      label: "Duplicate",
      onSelect: () =>
        runAndGo(() => actions.duplicate!(id)),
    });
  }
  if (canEdit && (status === "SENT" || status === "WON") && actions.newRevision) {
    items.push({
      key: "new-revision",
      label: "New revision",
      onSelect: () => runAndGo(() => actions.newRevision!(id)),
    });
  }
  items.push({ key: "print", label: "Print / Save PDF", href: `/print/quotes/${id}`, newTab: true });
  if (canRefreshCompany) {
    items.push({
      key: "refresh-company",
      label: "Use latest company details",
      onSelect: () => run(() => actions.refreshCompanyDetails!(id)),
    });
  }
  if (canEdit && approved && status !== "VOID") items.push({ key: "email", label: "Email", onSelect: () => run(() => actions.email(id)) });
  if (canEdit && approved && editable) items.push({ key: "convert", label: "Convert to SO", onSelect: () => setDialog("convert") });
  if (canEdit && editable) items.push({ key: "lost", label: "Mark lost", danger: true, onSelect: () => setDialog("lost") });
  if (canVoid && status !== "VOID") items.push({ key: "void", label: "Void", danger: true, onSelect: () => setDialog("void") });
  // S-66: former standalone primary buttons, now menu items (same gates).
  if (status === "WON" && openSalesOrderId) items.push({ key: "open-so", label: "Open sales order", href: `/sales-orders/${openSalesOrderId}` });
  if (canApproveWorkflow && actions.approve && actions.reject) {
    items.push({ key: "approve", label: "Approve", onSelect: () => run(() => actions.approve!(id)) });
    items.push({ key: "reject", label: "Reject", onSelect: () => setDialog("reject") });
  }
  if (canEdit && approved && status === "DRAFT") items.push({ key: "mark-sent", label: "Mark as sent", onSelect: onMarkSent });

  function onMarkSent() {
    const gate = quoteMarkSentGate({
      approved: approvalStatus === "APPROVED",
      withholdingUnset: withholdingNotSet,
      supplierCostMissing: costMissing,
    });
    if (gate === "need-approval") {
      setMessage(quoteNotApprovedError(approvalStatus));
      return;
    }
    if (gate === "cost-warning") {
      setDialog("cost");
      return;
    }
    if (gate === "withholding-unset") {
      setDialog("wh-none");
      return;
    }
    run(() => actions.markSent(id));
  }

  // S-66: the "Waiting for approval" note is status text, not an action,
  // so it stays beside the menu; every action itself lives in the menu.
  const waitingNote =
    !approved && status !== "VOID" && status !== "WON" && status !== "LOST" && !canApproveWorkflow ? (
      <span className="small muted" role="status" style={{ alignSelf: "center" }}>
        Waiting for approval
      </span>
    ) : null;

  return (
    <>
      {message && (
        <span role="alert" className="small" style={{ color: "var(--red)" }}>
          {message}
        </span>
      )}
      {okMessage && (
        <span role="status" className="small muted">
          {okMessage}
        </span>
      )}
      <ActionsMenu items={items} />
      {waitingNote}
      {dialog === "void" && (
        <VoidDialog
          docLabel="quote"
          body={`${number} will be marked Void and become read-only. Its number is kept and never reused.`}
          onClose={() => setDialog(null)}
          onVoid={(reason) => actions.void(id, reason)}
        />
      )}
      {dialog === "convert" && (
        <ConvertDialog number={number} defaultAddress={customerAddress} addressOptions={addressOptions} hasAcceptance={hasAcceptance} onClose={() => setDialog(null)} onConvert={(input) => actions.convert(id, input)} />
      )}
      <ConfirmDialog
        open={dialog === "lost"}
        title={`Mark ${number} as lost?`}
        body="The quote becomes read-only."
        confirmLabel="Mark lost"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          run(() => actions.markLost(id));
        }}
      />
      <ConfirmDialog
        open={dialog === "cost"}
        title={COST_NOT_SET_LABEL}
        body="One or more lines have no supplier cost. Margin will show Cost not set until you enter it. Save anyway?"
        confirmLabel="Save anyway"
        cancelLabel="Go back"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          if (withholdingNotSet) {
            setDialog("wh-none");
            return;
          }
          run(() => actions.markSent(id));
        }}
      />
      <ConfirmDialog
        open={dialog === "wh-none"}
        title={WITHHOLDING_NONE_CONFIRM_TITLE}
        body="No rates are picked. Save as none, or go back and pick rates."
        confirmLabel={WITHHOLDING_NONE_CONFIRM_YES}
        cancelLabel={WITHHOLDING_NONE_CONFIRM_PICK}
        onCancel={() => {
          setDialog(null);
          router.push(`/quotes/${id}/edit`);
        }}
        onConfirm={() => {
          setDialog(null);
          const fn = actions.confirmNoneAndMarkSent ?? actions.markSent;
          run(() => fn(id));
        }}
      />
      {dialog === "reject" && (
        <Modal title={`Reject ${number}?`} onClose={() => setDialog(null)} labelId="reject-quote-title">
          <p className="muted">Staff will see your reason. A reason is required.</p>
          <label className="field">
            <span>Reason</span>
            <textarea
              ref={rejectReasonRef}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              required
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={pending || !rejectReason.trim()}
              onClick={() => {
                const why = rejectReason.trim();
                if (!why) {
                  setMessage("Give a reason for rejecting this quote.");
                  return;
                }
                setDialog(null);
                run(() => actions.reject!(id, why));
              }}
            >
              Reject
            </button>
          </div>
        </Modal>
      )}
      {draft && <EmailDialog draft={draft} onClose={() => setDraft(null)} />}
    </>
  );
}

type SoProps = {
  id: string;
  number: string;
  status: string;
  canEdit: boolean;
  canVoid: boolean;
  voidAction: (id: string, reason: string) => Promise<FormState>;
  /** S-87: billings on this SO, for "Print billing statement" menu entries. */
  billings?: { id: string; number: string }[];
};

export function SalesOrderActions({ id, number, status, canEdit, canVoid, voidAction, billings = [], canBill = false, canCreatePos = false }: SoProps & { canBill?: boolean; canCreatePos?: boolean }) {
  const [voiding, setVoiding] = useState(false);
  const items: MenuItem[] = [];
  if (canEdit && status === "OPEN") items.push({ key: "edit", label: "Edit", href: `/sales-orders/${id}/edit` });
  // S-66: Record billing and Create POs used to sit beside the menu as
  // separate buttons on the SO page; they are menu items now.
  if (canBill) items.push({ key: "record-billing", label: "Record billing", href: `/billing/billings/new?salesOrderId=${id}` });
  if (canCreatePos) items.push({ key: "create-pos", label: "Create POs", href: `/sales-orders/${id}/purchase-orders` });
  items.push({ key: "print", label: "Print / Save PDF", href: `/print/sales-orders/${id}`, newTab: true });
  // S-87: one "Print billing statement" entry per billing, opening the
  // existing billing-statement print (never a sales invoice — the official
  // invoice is the BIR pre-printed booklet; the print itself says
  // "This is not an official invoice/receipt" and shows the booklet no.).
  // No entry when the SO has no billings yet.
  for (const b of billings) {
    items.push({ key: `print-billing-${b.id}`, label: `Print billing statement ${b.number}`, href: `/print/billings/${b.id}`, newTab: true });
  }
  // Audit A: a closed order can still be cancelled — void is the correction
  // path for OPEN and CLOSED alike. Edit stays OPEN-only.
  if (canVoid && (status === "OPEN" || status === "CLOSED")) items.push({ key: "void", label: "Void", danger: true, onSelect: () => setVoiding(true) });
  return (
    <>
      <ActionsMenu items={items} />
      {voiding && (
        <VoidDialog
          docLabel="sales order"
          body={`${number} will be marked Void and its quote goes back to Sent. The number is kept and never reused.`}
          onClose={() => setVoiding(false)}
          onVoid={(reason) => voidAction(id, reason)}
        />
      )}
    </>
  );
}
