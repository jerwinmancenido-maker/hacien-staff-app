"use client";

// Top-right of the quote page: every action lives in Actions ▾
// (S-66 — no separate blue main button; Approve, Reject, Mark as sent,
// Convert to SO and Open sales order are menu items).
// Viewers only get Print. The server re-checks every action.
//
// S-18 + prompt model (F5): Mark as sent / Email / Convert act freely once
// the quote is APPROVED, NOT_REQUIRED, or trips no threshold. A PENDING
// quote WITH reasons prompts an Approver/Admin to confirm-and-continue
// (recorded server-side); Staff-only users keep waiting for a real approver.
// Approver/Admin get Approve / Reject while PENDING.
//
// When withholding is not set on a draft, Mark as sent asks
// "No withholding on this quote?" — Yes, none / Pick rates.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionsMenu, type MenuItem } from "./ActionsMenu";
import { BusinessReclassifyForm } from "@/app/(app)/sales-orders/[id]/BusinessReclassifyForm";
import { RemindMeForm } from "@/components/RemindMeForm";
import { GapReasonForm } from "./GapReasonForm";
import { ConvertDialog, DeleteDialog, EmailDialog, Modal, VoidDialog, type AddressOption, type EmailDraftView, type NewAddressFields } from "./Dialogs";
import type { EditorAddressOption } from "./DocumentEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { COST_NOT_SET_LABEL } from "@/lib/quotes/calc";
import { quoteMarkSentGate, quoteNotApprovedError, type QuoteApprovalStatus } from "@/lib/quotes/approval";
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
  approvalStatus: QuoteApprovalStatus;
  /** Prompt model (F5): the threshold reasons this quote trips, if any. */
  approvalReasons?: string[];
  /** F26: true when the quote trips reasons this viewer may not see
   * (cost-based, hidden from Staff). A PENDING quote with hidden
   * reasons must not offer Staff actions the server will refuse. */
  approvalReasonsHidden?: boolean;
  canEdit: boolean;
  /** Admin or Approver. Staff keep Edit and do not see Void. */
  canVoid: boolean;
  /** Active Admin. Delete is shown only for a draft or void quote. */
  canDelete: boolean;
  canApproveWorkflow: boolean;
  /** An open sales order made from this quote, if any. */
  openSalesOrderId: string | null;
  /** Suggested delivery address (default delivery, else billing), editable in the dialog. */
  customerAddress: string;
  addressOptions?: AddressOption[];
  /** Customer identity for the Convert dialog's inline add-address path. */
  customerId?: string;
  customerName?: string;
  /** When true, Mark as sent shows the no-withholding confirm first. */
  withholdingNotSet?: boolean;
  /** Cost viewer, and at least one line has a blank or ₱0.00 supplier cost. */
  costMissing?: boolean;
  /** Audit: a conforme file is on file or acceptance is recorded. */
  hasAcceptance?: boolean;
  /** E15: the business this quote is tagged to, if any (Convert dialog note). */
  businessName?: string;
  /** REQ-REMIND-ACTIONS-001: the page passes its own edit_data gate; the
   * menu item shows exactly when the old page-body RemindMeForm card did. */
  canRemind?: boolean;
  reminderAction?: (state: FormState, form: FormData) => Promise<FormState>;
  actions: {
    markSent: (id: string, confirmedWarnings?: boolean) => Promise<FormState>;
    /** Saves explicit none then marks sent (Yes, none). */
    confirmNoneAndMarkSent?: (id: string, confirmedWarnings?: boolean) => Promise<FormState>;
    markLost: (id: string) => Promise<FormState>;
    void: (id: string, reason: string) => Promise<FormState>;
    delete: (id: string, reason: string) => Promise<FormState>;
    convert: (id: string, input: { buyerPoNo: string; buyerPoDate: string; deliveryAddressId: string; deliveryAddress?: string; confirmedWarnings?: boolean }) => Promise<FormState>;
    /** Convert dialog "+ Add new address": saves a DELIVERY address to the customer. */
    addAddress?: (customerId: string, input: NewAddressFields) => Promise<FormState & { address?: EditorAddressOption }>;
    email: (id: string, confirmedWarnings?: boolean) => Promise<FormState & { draft?: EmailDraftView }>;
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
  approvalReasons = [],
  approvalReasonsHidden = false,
  canEdit,
  canVoid,
  canDelete,
  canApproveWorkflow,
  openSalesOrderId,
  customerAddress,
  addressOptions,
  customerId,
  customerName,
  withholdingNotSet = false,
  costMissing = false,
  hasAcceptance = false,
  businessName,
  canRemind = false,
  reminderAction,
  actions,
}: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"void" | "delete" | "convert" | "lost" | "wh-none" | "cost" | "reject" | "approval" | "remind" | null>(null);
  /** Which send waits behind the approval prompt (F5). */
  const [pendingSend, setPendingSend] = useState<"mark" | "none" | "email" | null>(null);
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

  // Prompt model (F5): APPROVED / NOT_REQUIRED / clean-PENDING quotes act
  // freely. A PENDING quote WITH reasons acts only for an Approver, and only
  // through the confirm prompt; Staff keep waiting. REJECTED never acts.
  // F26: reasons hidden from this viewer (cost-based, Staff) block just
  // the same — an empty visible list must not read as a clean quote.
  const blockedHidden = approvalStatus === "PENDING" && approvalReasonsHidden && !canApproveWorkflow;
  const needsPrompt = approvalStatus === "PENDING" && approvalReasons.length > 0;
  const approved =
    approvalStatus === "APPROVED" ||
    approvalStatus === "NOT_REQUIRED" ||
    (approvalStatus === "PENDING" && !blockedHidden && (approvalReasons.length === 0 || canApproveWorkflow));
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
  // REQ-REMIND-ACTIONS-001: the Remind-me card moved off the page body
  // into this menu; the dialog holds the existing form unchanged.
  if (canRemind && reminderAction) items.push({ key: "remind", label: "Set a reminder…", onSelect: () => setDialog("remind") });
  if (canRefreshCompany) {
    items.push({
      key: "refresh-company",
      label: "Use latest company details",
      onSelect: () => run(() => actions.refreshCompanyDetails!(id)),
    });
  }
  if (canEdit && approved && status !== "VOID")
    items.push({
      key: "email",
      label: "Email",
      onSelect: () => {
        if (needsPrompt) {
          setPendingSend("email");
          setDialog("approval");
          return;
        }
        run(() => actions.email(id));
      },
    });
  if (canEdit && approved && editable) items.push({ key: "convert", label: "Convert to SO", onSelect: () => setDialog("convert") });
  if (canEdit && editable) items.push({ key: "lost", label: "Mark lost", danger: true, onSelect: () => setDialog("lost") });
  if (canVoid && status !== "VOID") items.push({ key: "void", label: "Void", danger: true, onSelect: () => setDialog("void") });
  if (canDelete && (status === "DRAFT" || status === "VOID")) {
    items.push({ key: "delete", label: "Delete", danger: true, onSelect: () => setDialog("delete") });
  }
  // S-66: former standalone primary buttons, now menu items (same gates).
  if (status === "WON" && openSalesOrderId) items.push({ key: "open-so", label: "Open sales order", href: `/sales-orders/${openSalesOrderId}` });
  if (canApproveWorkflow && actions.approve && actions.reject) {
    items.push({ key: "approve", label: "Approve", onSelect: () => run(() => actions.approve!(id)) });
    items.push({ key: "reject", label: "Reject", onSelect: () => setDialog("reject") });
  }
  if (canEdit && approved && status === "DRAFT") items.push({ key: "mark-sent", label: "Mark as sent", onSelect: onMarkSent });

  /** Runs a send now; `confirmed` carries the Approver's prompt confirmation. */
  function doSend(kind: "mark" | "none" | "email", confirmed: boolean) {
    if (kind === "email") {
      run(() => actions.email(id, confirmed));
      return;
    }
    const fn = kind === "none" ? (actions.confirmNoneAndMarkSent ?? actions.markSent) : actions.markSent;
    run(() => fn(id, confirmed));
  }

  /** Last step before a mark-sent: the approval prompt when one is owed. */
  function finishSend(kind: "mark" | "none") {
    if (needsPrompt) {
      setPendingSend(kind);
      setDialog("approval");
      return;
    }
    doSend(kind, false);
  }

  function onMarkSent() {
    if (approvalStatus === "REJECTED" || (needsPrompt && !canApproveWorkflow)) {
      setMessage(quoteNotApprovedError(approvalStatus));
      return;
    }
    const gate = quoteMarkSentGate({
      approved: true,
      withholdingUnset: withholdingNotSet,
      supplierCostMissing: costMissing,
    });
    if (gate === "cost-warning") {
      setDialog("cost");
      return;
    }
    if (gate === "withholding-unset") {
      setDialog("wh-none");
      return;
    }
    finishSend("mark");
  }

  // S-66: the "Waiting for approval" note is status text, not an action,
  // so it stays beside the menu; every action itself lives in the menu.
  const waitingNote =
    !approved && status !== "VOID" && status !== "WON" && status !== "LOST" && !canApproveWorkflow ? (
      <span className="small muted" role="status" style={{ alignSelf: "center" }}>
        {/* F26: say WHY in generic words — the real reason may be
            cost-based and hidden from Staff. */}
        Waiting for approval — an Approver or Admin must approve it before it can be sent or converted
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
      {dialog === "delete" && (
        <DeleteDialog
          number={number}
          body={`${number} will be deleted. This cannot be undone, and its number will not be reused.`}
          onClose={() => setDialog(null)}
          onDelete={(reason) => actions.delete(id, reason)}
        />
      )}
      {dialog === "convert" && (
        <ConvertDialog number={number} defaultAddress={customerAddress} addressOptions={addressOptions} hasAcceptance={hasAcceptance} approvalWarning={needsPrompt ? approvalReasons : undefined} businessName={businessName} customerName={customerName} onAddAddress={actions.addAddress && customerId ? (input) => actions.addAddress!(customerId, input) : undefined} onClose={() => setDialog(null)} onConvert={(input) => actions.convert(id, input)} />
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
          finishSend("mark");
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
          finishSend("none");
        }}
      />
      <ConfirmDialog
        open={dialog === "approval"}
        title="This quote needs approval"
        body={`It trips the approval checks: ${approvalReasons.join("; ")}. As an Approver you can continue anyway — your confirmation is recorded in the activity log.`}
        confirmLabel="Continue anyway"
        cancelLabel="Go back"
        onCancel={() => {
          setDialog(null);
          setPendingSend(null);
        }}
        onConfirm={() => {
          const kind = pendingSend ?? "mark";
          setDialog(null);
          setPendingSend(null);
          doSend(kind, true);
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
      {dialog === "remind" && reminderAction && (
        <Modal title="Set a reminder" onClose={() => setDialog(null)} labelId="quote-remind-title">
          <RemindMeForm entityType="QUOTE" entityId={id} action={reminderAction} />
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={() => setDialog(null)}>
              Close
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
  /** Active Admin. Delete is shown only for a void sales order. */
  canDelete: boolean;
  voidAction: (id: string, reason: string) => Promise<FormState>;
  deleteAction: (id: string, reason: string) => Promise<FormState>;
  /** S-87: billings on this SO, for "Print billing statement" menu entries. */
  billings?: { id: string; number: string }[];
};

export function SalesOrderActions({ id, number, status, canEdit, canVoid, canDelete, voidAction, deleteAction, billings = [], canBill = false, canCreatePos = false, canCollect = false, canRecordDelivery = false, customerId, isAdmin = false, ownCompanyName, currentBusinessId = null, businesses = [], reclassifyBusinessAction, showGapNote = false, gapPartial = false, gapReasonCode = null, currentGapNote = null, setGapReasonAction, canRemind = false, reminderAction }: SoProps & { canBill?: boolean; canCreatePos?: boolean; canCollect?: boolean; canRecordDelivery?: boolean; customerId?: string; isAdmin?: boolean; ownCompanyName?: string; currentBusinessId?: string | null; businesses?: { id: string; name: string; active: boolean }[]; reclassifyBusinessAction?: (state: FormState, form: FormData) => Promise<FormState>; showGapNote?: boolean; gapPartial?: boolean; gapReasonCode?: string | null; currentGapNote?: string | null; setGapReasonAction?: (state: FormState, form: FormData) => Promise<FormState>; canRemind?: boolean; reminderAction?: (state: FormState, form: FormData) => Promise<FormState> }) {
  const [voiding, setVoiding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [businessOpen, setBusinessOpen] = useState(false);
  const [gapNoteOpen, setGapNoteOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const items: MenuItem[] = [];
  if (canEdit && status === "OPEN") items.push({ key: "edit", label: "Edit", href: `/sales-orders/${id}/edit` });
  // S-66: Record billing and Create POs used to sit beside the menu as
  // separate buttons on the SO page; they are menu items now.
  if (canBill) items.push({ key: "record-billing", label: "Record billing", href: `/billing/billings/new?salesOrderId=${id}` });
  if (canCollect && customerId) items.push({ key: "record-collection", label: "Record collection", href: `/billing/collections/new?customerId=${customerId}` });
  // Adoption item 12: Record delivery deep-links into the Deliveries tab
  // with the existing delivery form open — never a second form. The page
  // shows it only while a delivery can actually be recorded (OPEN order,
  // edit_data, qty still remaining), mirroring DeliverySection's own gate.
  if (canRecordDelivery) items.push({ key: "record-delivery", label: "Record delivery", href: `/sales-orders/${id}?tab=deliveries&record=1` });
  if (canCreatePos) items.push({ key: "create-pos", label: "Create POs", href: `/sales-orders/${id}/purchase-orders` });
  // REQ-SO-ACTIONS-MOVE-001: the Business card and the billing gap-note
  // card moved off the page body into this menu; each item opens the
  // existing form in a dialog, under the same conditions as the cards.
  if (isAdmin && reclassifyBusinessAction) items.push({ key: "change-business", label: "Change business…", onSelect: () => setBusinessOpen(true) });
  if (showGapNote && setGapReasonAction) items.push({ key: "billing-gap-note", label: "Billing gap note…", onSelect: () => setGapNoteOpen(true) });
  // REQ-REMIND-ACTIONS-001: the Remind-me card moved off the page body
  // into this menu; the dialog holds the existing form unchanged.
  if (canRemind && reminderAction) items.push({ key: "set-reminder", label: "Set a reminder…", onSelect: () => setRemindOpen(true) });
  items.push({ key: "print", label: "Print / Save PDF", href: `/print/sales-orders/${id}`, newTab: true });
  // S-87: one "Print billing statement" entry per billing, opening the
  // existing billing-statement print (never a sales invoice — the official
  // invoice is the BIR pre-printed booklet; the print itself carries
  // the shared BIR reference-only disclaimer and shows the booklet no.).
  // No entry when the SO has no billings yet.
  for (const b of billings) {
    items.push({ key: `print-billing-${b.id}`, label: `Print billing statement ${b.number}`, href: `/print/billings/${b.id}`, newTab: true });
  }
  // Audit A: a closed order can still be cancelled — void is the correction
  // path for OPEN and CLOSED alike. Edit stays OPEN-only.
  if (canVoid && (status === "OPEN" || status === "CLOSED")) items.push({ key: "void", label: "Void", danger: true, onSelect: () => setVoiding(true) });
  if (canDelete && status === "VOID") items.push({ key: "delete", label: "Delete", danger: true, onSelect: () => setDeleting(true) });
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
      {deleting && (
        <DeleteDialog
          number={number}
          body={`${number} will be deleted. This cannot be undone, and its number will not be reused.`}
          onClose={() => setDeleting(false)}
          onDelete={(reason) => deleteAction(id, reason)}
        />
      )}
      {businessOpen && reclassifyBusinessAction && ownCompanyName !== undefined && (
        <Modal title="Change business" onClose={() => setBusinessOpen(false)} labelId="so-change-business-title">
          <BusinessReclassifyForm ownCompanyName={ownCompanyName} currentBusinessId={currentBusinessId} businesses={businesses} action={reclassifyBusinessAction} />
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={() => setBusinessOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
      {gapNoteOpen && setGapReasonAction && (
        <Modal title="Billing gap note" onClose={() => setGapNoteOpen(false)} labelId="so-gap-note-title">
          <GapReasonForm kind="SO" currentCode={gapReasonCode} currentNote={currentGapNote} action={setGapReasonAction} partial={gapPartial} />
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={() => setGapNoteOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
      {remindOpen && reminderAction && (
        <Modal title="Set a reminder" onClose={() => setRemindOpen(false)} labelId="so-remind-title">
          <RemindMeForm entityType="SALES_ORDER" entityId={id} action={reminderAction} />
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={() => setRemindOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
