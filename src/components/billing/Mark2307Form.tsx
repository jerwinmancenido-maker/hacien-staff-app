"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { mark2307ReceivedAction } from "@/app/(app)/billing/actions";
import { Modal } from "@/components/docs/Dialogs";

export function Mark2307Form({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const action = mark2307ReceivedAction.bind(null, id);
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};

  return (
    <>
      <button type="button" className="btn-link small" onClick={() => setOpen(true)}>
        Mark received
      </button>
      {open && (
        <Modal title="Mark 2307 received" onClose={() => setOpen(false)} labelId={`mark-2307-${id}`}>
          <form
            noValidate
            onSubmit={(ev) => {
              ev.preventDefault();
              submit(ev.currentTarget);
            }}
          >
            {state.message && (
              <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
                {state.message}
              </div>
            )}
            {state.ok && <p className="faint">Saved. You can close this dialog.</p>}
            <div className="form-grid">
              <div className={`field${e.receivedAt ? " has-error" : ""}`}>
                <label htmlFor={`recv-${id}`}>Date received</label>
                <input id={`recv-${id}`} name="receivedAt" type="date" required />
                {e.receivedAt && <div className="error">{e.receivedAt}</div>}
              </div>
              <div className="field full">
                <label htmlFor={`notes-${id}`}>Notes</label>
                <textarea id={`notes-${id}`} name="notes" rows={2} />
              </div>
              <div className={`field full${e.files ? " has-error" : ""}`}>
                <label htmlFor={`files-${id}`}>Certificate (PDF/JPG/PNG)</label>
                <input id={`files-${id}`} name="files" type="file" accept=".pdf,.png,.jpg,.jpeg" multiple />
                {e.files && <div className="error">{e.files}</div>}
              </div>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Mark received"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
