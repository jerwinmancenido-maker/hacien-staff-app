"use client";

import { useId, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { Modal } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";
import { formatPeso } from "@/lib/format";

type BoundAction = (state: FormState, form: FormData) => Promise<FormState>;

/** Approve / reject buttons for one PENDING payment request (queue page). */
export function PaymentRequestActions({
  approveAction,
  rejectAction,
  amount,
  billNumber,
}: {
  approveAction: BoundAction;
  rejectAction: BoundAction;
  amount: string;
  billNumber: string;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const uid = useId();
  const approve = useFormAction(approveAction);
  const reject = useFormAction(rejectAction);
  const e = reject.state.fieldErrors ?? {};

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          approve.submit(ev.currentTarget);
        }}
      >
        <button className="btn small" type="submit" disabled={approve.pending}>
          {approve.pending ? "Approving…" : "Approve"}
        </button>
      </form>
      <button type="button" className="btn btn-secondary small" onClick={() => setRejectOpen(true)}>
        Reject
      </button>
      {approve.state.message && (
        <span className={approve.state.ok ? "small" : "small error-text"} role="status">
          {approve.state.message}
        </span>
      )}
      {rejectOpen && (
        <Modal title={`Reject payment request — bill ${billNumber}`} onClose={() => setRejectOpen(false)} labelId={`reject-pr-${uid}`}>
          <form
            noValidate
            onSubmit={(ev) => {
              ev.preventDefault();
              reject.submit(ev.currentTarget);
            }}
          >
            {reject.state.message && (
              <div className={`alert ${reject.state.ok ? "ok" : "error"}`} role="status">
                {reject.state.message}
              </div>
            )}
            {reject.state.ok ? (
              <p className="faint">Done. You can close this dialog.</p>
            ) : (
              <>
                <p className="small" style={{ marginBottom: 12 }}>
                  The request for {formatPeso(amount)} goes back to the requester as rejected. Say why, so they can fix
                  and re-request.
                </p>
                <div className="form-grid">
                  <div className={`field full${e.note ? " has-error" : ""}`}>
                    <label htmlFor={`reject-note-${uid}`}>Reason</label>
                    <textarea id={`reject-note-${uid}`} name="note" rows={3} required />
                    {e.note && <div className="error">{e.note}</div>}
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn" type="submit" disabled={reject.pending}>
                    {reject.pending ? "Rejecting…" : "Reject request"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setRejectOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            )}
          </form>
        </Modal>
      )}
    </span>
  );
}
