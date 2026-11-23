"use client";

import { useId, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { NoIdUploadWarning } from "@/components/NoIdUploadWarning";
import { FileInput } from "@/components/FileInput";
import { Modal } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";

/**
 * Mark a supplier 2307 as issued. The wide form lives in a modal — the
 * same pattern as billing's Mark2307Form — so the list's action cell
 * holds only a compact trigger and the table keeps its phone/tablet
 * geometry (findings 1026/1045 residue: the inline form's cell was the
 * payables/2307 table's half-cut last column at 768px).
 */
export function Mark2307IssuedForm({
  action,
  defaultDate,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <>
      <button type="button" className="btn-link small" onClick={() => setOpen(true)}>
        Mark issued
      </button>
      {open && (
        <Modal title="Mark 2307 issued" onClose={() => setOpen(false)} labelId={`mark-issued-${uid}`}>
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
              <div className={`field${e.issuedAt ? " has-error" : ""}`}>
                <label htmlFor={`issued-${uid}`}>Date issued</label>
                <input id={`issued-${uid}`} name="issuedAt" type="date" defaultValue={defaultDate} required />
                {e.issuedAt && <div className="error">{e.issuedAt}</div>}
              </div>
              <div className={`field full${e.files ? " has-error" : ""}`}>
                <label htmlFor={`files-${uid}`}>Certificate (PDF/JPG/PNG)</label>
                <FileInput id={`files-${uid}`} name="files" accept=".pdf,.png,.jpg,.jpeg" />
                <NoIdUploadWarning />
                {e.files && <div className="error">{e.files}</div>}
              </div>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Mark issued"}
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
