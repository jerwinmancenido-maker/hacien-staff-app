"use client";

// REQ-ATTACH-001: upload files to a sales order or purchase order, with the
// kind pick (Customer PO / Supplier quote / Other). Mirrors ConformeUploadForm.
import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { FileInput } from "@/components/FileInput";
import { ATTACHMENT_KIND_LABELS, type AttachmentKind } from "@/lib/attachment-kinds";
import { clientUploadSizeError } from "@/lib/business-docs/sniff";
import type { FormState } from "@/lib/validation/forms";

export function AttachmentUploadForm({
  action,
  kinds,
  idPrefix,
  maxMb,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  kinds: readonly AttachmentKind[];
  idPrefix: string;
  maxMb: number;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <form onSubmit={onSubmit} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${idPrefix}-kind`}>Kind of file</label>
        <select id={`${idPrefix}-kind`} name="kind" defaultValue={kinds[0]}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {ATTACHMENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {e.kind && <div className="error">{e.kind}</div>}
      </div>
      <div className={`field${e.files || fileError ? " has-error" : ""}`}>
        <label htmlFor={`${idPrefix}-files`}>Files (PDF or photo, up to 5)</label>
        <FileInput
          id={`${idPrefix}-files`}
          name="files"
          multiple
          onFilesChange={(files) => setFileError(clientUploadSizeError(files, maxMb))}
        />
        {(e.files || fileError) && <div className="error">{e.files ?? fileError}</div>}
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending || !!fileError}>
          {pending ? "Uploading…" : "Attach files"}
        </button>
      </div>
    </form>
  );
}
