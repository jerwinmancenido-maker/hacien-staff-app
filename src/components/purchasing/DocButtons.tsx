"use client";

// Small client buttons that open a reason dialog: void a receiving report /
// bill, or close a PO (short-close needs a reason).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, VoidDialog } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";

export function VoidButton({ label, docLabel, body, onVoid }: { label: string; docLabel: string; body: string; onVoid: (reason: string) => Promise<FormState> }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm danger" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <VoidDialog
          docLabel={docLabel}
          body={body}
          onClose={() => setOpen(false)}
          onVoid={async (reason) => {
            const res = await onVoid(reason);
            if (res.ok) router.refresh();
            return res;
          }}
        />
      )}
    </>
  );
}

export function CloseDialog({ number, needsReason, onClose, onConfirm }: { number: string; needsReason: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<FormState> }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  const error = state.fieldErrors?.reason ?? (!state.ok ? state.message : undefined);
  return (
    <Modal title={`Close ${number}?`} onClose={onClose} labelId="close-title">
      <p>
        {needsReason
          ? "Not everything has been received. Closing now short-closes the PO: the rest won't be received on it."
          : "Everything has been received. The PO becomes read-only (bills can still be recorded)."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          const res = await onConfirm(reason);
          setPending(false);
          if (res.ok) onClose();
          else setState(res);
        }}
      >
        <div className={`field${error ? " has-error" : ""}`}>
          <label htmlFor="close-reason">
            Reason{needsReason && <span className="req"> *</span>}
          </label>
          <textarea id="close-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={pending || (needsReason && reason.trim().length < 3)}>
            {pending ? "Closing…" : needsReason ? "Short-close PO" : "Close PO"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
