"use client";

// S-70: upload a signed conforme scan on the quote page.
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";

export function ConformeUploadForm({ action }: { action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <div className="field">
        <label htmlFor="conforme-file">Signed conforme file</label>
        <input id="conforme-file" name="file" type="file" />
        {e.file && <div className="error">{e.file}</div>}
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload signed conforme"}
        </button>
      </div>
    </form>
  );
}
