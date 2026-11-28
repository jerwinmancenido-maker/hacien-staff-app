"use client";

// Settings → Quote terms: named payment-term presets (ERP adoption
// item 10). A preset is a typing shortcut for the Quote / SO editors —
// picking one fills the document's terms field with the preset's text,
// and the document stores only that text, so editing a preset here never
// rewrites a document already made. Saving asks first, then writes a new
// settings version. Presets are never deleted; untick "Active".

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { PaymentTermPreset } from "@/lib/settings/schema";
import type { FormState } from "@/lib/validation/forms";

export function PaymentTermPresetsForm({
  presets: initial,
  versionId,
  action,
}: {
  presets: PaymentTermPreset[];
  versionId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const { state, pending, submit } = useFormAction(action);
  const [rows, setRows] = useState<PaymentTermPreset[]>(initial);
  // After a save the page re-renders with the saved rows: take them.
  const [seenVersion, setSeenVersion] = useState(versionId);
  if (seenVersion !== versionId) {
    setSeenVersion(versionId);
    setRows(initial);
  }
  const [confirming, setConfirming] = useState(false);
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const e = state.fieldErrors ?? {};
  const set = (i: number, patch: Partial<PaymentTermPreset>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const rowError = (i: number) => ["name", "text"].map((f) => e[`${i}.${f}`]).find(Boolean);

  return (
    <div className="card settings-section">
      <h2 className="settings-section-title">Payment term presets</h2>
      <p className="small muted">
        In the quote and sales-order editors, picking a preset fills the terms field with the preset&apos;s text. The
        document keeps only that text — changing a preset later never changes a document already made. The names
        &ldquo;COD&rdquo;, &ldquo;50/50&rdquo; and &ldquo;Net 30&rdquo; are matched by the printed payment schedule, so
        keep them as they are.
      </p>
      <form
        ref={setFormEl}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          setConfirming(true);
        }}
      >
        <div className="edit-topbar">
          <span className="small faint">Changes apply to new documents only.</span>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
        {state.message && (
          <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
            {state.message}
          </div>
        )}
        <input type="hidden" name="baseVersionId" value={versionId} />
        <input type="hidden" name="rows" value={JSON.stringify(rows)} />
        <div className="table-wrap edit-table">
          <table className="list">
            <thead>
              <tr>
                <th className="col-label">Name</th>
                <th className="col-note">Terms text it fills in</th>
                <th className="col-active">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`preset-${i}`}>
                  <td className="col-label" data-label="Name">
                    <input
                      aria-label="Preset name"
                      value={r.name}
                      onChange={(ev) => set(i, { name: ev.target.value })}
                    />
                    {rowError(i) && (
                      <div className="error small" role="alert">
                        {rowError(i)}
                      </div>
                    )}
                  </td>
                  <td className="col-note" data-label="Terms text">
                    <input
                      aria-label="Terms text"
                      value={r.text}
                      onChange={(ev) => set(i, { text: ev.target.value })}
                    />
                  </td>
                  <td className="col-active" data-label="Active">
                    <label className="check">
                      <input
                        aria-label="Active"
                        type="checkbox"
                        checked={r.active}
                        onChange={(ev) => set(i, { active: ev.target.checked })}
                      />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-actions settings-form-actions">
          <span className="small faint settings-form-footnote">Presets can&apos;t be deleted; untick Active to stop offering one.</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRows((rs) => [...rs, { name: "", text: "", active: true }])}
          >
            Add preset
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title="Change payment term presets?"
        body="This saves a new settings version. Documents already made keep the terms text they were saved with."
        confirmLabel="Save changes"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (formEl) submit(formEl);
        }}
      />
    </div>
  );
}
