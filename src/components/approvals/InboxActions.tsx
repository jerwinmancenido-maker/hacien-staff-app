"use client";

// Approval inbox row actions. Same shape as the document pages' actions
// (useTransition + FormState messages, Modal for the reject reason) —
// the server actions behind them call the same approval services.

import { useEffect, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";

function useRowAction() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<FormState>) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? null : (res.message ?? res.fieldErrors?.reason ?? "Something went wrong."));
    });
  return { message, pending, run };
}

export function QuoteApprovalButtons({
  id,
  number,
  approve,
  reject,
}: {
  id: string;
  number: string;
  approve: (id: string) => Promise<FormState>;
  reject: (id: string, reason: string) => Promise<FormState>;
}) {
  const { message, pending, run } = useRowAction();
  const [dialog, setDialog] = useState<"reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const rejectReasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (dialog === "reject") rejectReasonRef.current?.focus();
  }, [dialog]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => approve(id))}>
          Approve
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => setDialog("reject")}>
          Reject
        </button>
      </div>
      {message && (
        <div className="small" style={{ color: "var(--red)" }} role="alert">
          {message}
        </div>
      )}
      {dialog === "reject" && (
        <Modal title={`Reject ${number}?`} onClose={() => setDialog(null)} labelId="inbox-reject-quote-title">
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
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending || !rejectReason.trim()}
              onClick={() => {
                const why = rejectReason.trim();
                if (!why) return;
                setDialog(null);
                run(() => reject(id, why));
              }}
            >
              Reject
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function PoApprovalButton({
  id,
  approve,
}: {
  id: string;
  approve: (id: string) => Promise<FormState>;
}) {
  const { message, pending, run } = useRowAction();
  return (
    <>
      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => approve(id))}>
        Approve
      </button>
      {message && (
        <div className="small" style={{ color: "var(--red)" }} role="alert">
          {message}
        </div>
      )}
    </>
  );
}
