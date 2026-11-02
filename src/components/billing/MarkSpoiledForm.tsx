"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { markBookletNumberSpoiledAction } from "@/app/(app)/billing/actions";
import { Modal } from "@/components/docs/Dialogs";
import type { BookletType } from "@/lib/billing/booklet";

export function MarkSpoiledForm({
  type,
  typeName,
  nextFree,
}: {
  type: BookletType;
  typeName: string;
  nextFree: number | null;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, submit } = useFormAction(markBookletNumberSpoiledAction);
  const e = state.fieldErrors ?? {};

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        Mark spoiled
      </button>
      {open && (
        <Modal title={`Mark ${typeName} number spoiled`} onClose={() => setOpen(false)} labelId="mark-spoiled-modal">
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
            {state.ok && <p className="faint">Saved. The number stays on record and cannot be reused.</p>}
            <input type="hidden" name="type" value={type} />
            <div className="form-grid">
              <div className={`field${e.number ? " has-error" : ""}`}>
                <label htmlFor="spoiled-number">Booklet serial number</label>
                <input
                  id="spoiled-number"
                  name="number"
                  type="number"
                  defaultValue={nextFree ? String(nextFree) : ""}
                  required
                />
                <span className="hint faint small">Serial number printed on the physical booklet.</span>
                {e.number && <div className="error">{e.number}</div>}
              </div>
              <div className={`field full${e.reason ? " has-error" : ""}`}>
                <label htmlFor="spoiled-reason">Reason (required)</label>
                <textarea
                  id="spoiled-reason"
                  name="reason"
                  rows={2}
                  placeholder="e.g. Printer feed jam, misprint, ink smudge"
                  required
                />
                {e.reason && <div className="error">{e.reason}</div>}
              </div>
              <div className={`field full${e.files ? " has-error" : ""}`}>
                <label htmlFor="spoiled-files">Photo of spoiled booklet sheet (required)</label>
                <input
                  id="spoiled-files"
                  name="files"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  required
                />
                {e.files && <div className="error">{e.files}</div>}
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Mark spoiled"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
