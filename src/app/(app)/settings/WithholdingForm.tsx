"use client";

// Settings → Withholding: an editable table of rates. Saving asks first, then
// writes a new settings version. Rates are never deleted; untick "Active".

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LINE_KIND_LABELS, WITHHOLDING_LINE_KINDS } from "@/lib/validation/withholding";
import type { FormState } from "@/lib/validation/forms";

export type RateRow = {
  id?: string;
  code: string;
  label: string;
  lineKind: string;
  atcCode: string;
  ratePct: string;
  active: boolean;
  note: string;
};

export function WithholdingForm({
  rows: initial,
  versionId,
  action,
}: {
  rows: RateRow[];
  versionId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const { state, pending, submit } = useFormAction(action);
  const [rows, setRows] = useState<RateRow[]>(initial);
  // After a save the page re-renders with the saved rows (new ones now have ids): take them.
  const [seenVersion, setSeenVersion] = useState(versionId);
  if (seenVersion !== versionId) {
    setSeenVersion(versionId);
    setRows(initial);
  }
  const [confirming, setConfirming] = useState(false);
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const e = state.fieldErrors ?? {};
  const set = (i: number, patch: Partial<RateRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const rowError = (i: number) =>
    ["code", "label", "lineKind", "atcCode", "ratePct", "note"].map((f) => e[`${i}.${f}`]).find(Boolean);

  return (
    <div className="card">
      <h2>Withholding rates</h2>
      <div className="alert warn" role="note">
        <b>Rates must be verified with BIR / accountant.</b> These are examples only. Changes apply to new quotes; existing quotes keep the
        rates they were made with.
      </div>
      <form
        ref={setFormEl}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          setConfirming(true);
        }}
      >
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
                <th>Code</th>
                <th>Label</th>
                <th>Applies to</th>
                <th>ATC</th>
                <th className="num">Rate %</th>
                <th>Active</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? `new-${i}`}>
                  <td>
                    <input
                      aria-label="Code"
                      value={r.code}
                      readOnly={!!r.id}
                      onChange={(ev) => set(i, { code: ev.target.value.toUpperCase() })}
                      style={{ width: 120 }}
                    />
                    {rowError(i) && (
                      <div className="error small" role="alert">
                        {rowError(i)}
                      </div>
                    )}
                  </td>
                  <td>
                    <input aria-label="Label" value={r.label} onChange={(ev) => set(i, { label: ev.target.value })} />
                  </td>
                  <td>
                    <select aria-label="Applies to" value={r.lineKind} onChange={(ev) => set(i, { lineKind: ev.target.value })}>
                      {WITHHOLDING_LINE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {LINE_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input aria-label="ATC code" value={r.atcCode} onChange={(ev) => set(i, { atcCode: ev.target.value })} placeholder="—" style={{ width: 80 }} />
                  </td>
                  <td className="num">
                    <input aria-label="Rate percent" value={r.ratePct} inputMode="decimal" onChange={(ev) => set(i, { ratePct: ev.target.value })} style={{ width: 70, textAlign: "right" }} />
                  </td>
                  <td>
                    <input aria-label="Active" type="checkbox" checked={r.active} onChange={(ev) => set(i, { active: ev.target.checked })} />
                  </td>
                  <td>
                    <input aria-label="Note" value={r.note} onChange={(ev) => set(i, { note: ev.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRows((rs) => [...rs, { code: "", label: "", lineKind: "GOODS", atcCode: "", ratePct: "", active: true, note: "verify with BIR" }])}
          >
            Add rate
          </button>
          <span className="small faint">Rates can&apos;t be deleted; untick Active to stop offering one.</span>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title="Change withholding rates?"
        body="This saves a new settings version. Quotes already made keep the old rates."
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
