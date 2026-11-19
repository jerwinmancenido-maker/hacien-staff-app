"use client";

// Settings → Businesses: the catalogue of OTHER businesses whose
// transactions are recorded in this app (Reconciliation Plan 2026-11-19).
// The app's own company is the permanent default and is not listed here.

import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import type { BusinessRow } from "@/lib/services/businesses";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

function BusinessRowForm({ row, saveAction, toggleAction }: { row: BusinessRow; saveAction: Action; toggleAction: Action }) {
  const save = useFormAction(saveAction);
  const toggle = useFormAction(toggleAction);
  const e = save.state.fieldErrors ?? {};
  return (
    <div className="business-row" style={{ borderTop: "1px solid var(--border, #e5e7eb)", padding: "10px 0" }}>
      <form onSubmit={save.onSubmit}>
        <input type="hidden" name="id" value={row.id} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="small" style={{ flex: "2 1 220px" }}>
            Business name
            <input name="name" defaultValue={row.name} disabled={!row.active} />
            {e.name && <span className="field-error">{e.name}</span>}
          </label>
          <label className="small" style={{ flex: "1 1 110px" }}>
            Short label
            <input name="shortLabel" defaultValue={row.shortLabel} disabled={!row.active} />
            {e.shortLabel && <span className="field-error">{e.shortLabel}</span>}
          </label>
          <button className="btn" type="submit" disabled={save.pending || !row.active}>
            {save.pending ? "Saving…" : "Save"}
          </button>
        </div>
        {save.state.message && (
          <div className={`alert ${save.state.ok ? "ok" : "error"}`} role="status">
            {save.state.message}
          </div>
        )}
      </form>
      <form onSubmit={toggle.onSubmit} style={{ marginTop: 6 }}>
        <input type="hidden" name="id" value={row.id} />
        {/* The shared bool() form parser accepts on/true/yes only — send "true"/"false" (E1: "1" made Switch on a no-op). */}
        <input type="hidden" name="active" value={row.active ? "false" : "true"} />
        <div className="small faint" style={{ marginBottom: 4 }}>
          {row.active ? "Active — can be picked on new quotes." : "Switched off — existing records keep the label; no new quotes."}
        </div>
        <button className="btn ghost" type="submit" disabled={toggle.pending}>
          {row.active ? "Switch off" : "Switch on"}
        </button>
        {toggle.state.message && !toggle.state.ok && (
          <div className="alert error" role="status">
            {toggle.state.message}
          </div>
        )}
      </form>
    </div>
  );
}

export function BusinessesForm({
  ownCompanyName,
  businesses,
  saveAction,
  toggleAction,
}: {
  ownCompanyName: string;
  businesses: BusinessRow[];
  saveAction: Action;
  toggleAction: Action;
}) {
  const add = useFormAction(saveAction);
  const e = add.state.fieldErrors ?? {};
  return (
    <div className="card settings-section">
      {/* No own title here — the settings page intro card already titles the section (E9). */}
      <p className="small muted">
        <strong>{ownCompanyName}</strong> is this app&apos;s own company — it is always the default and is not in this
        list. Add another business here only when you record that business&apos;s transactions in this app: its quotes
        and orders are then tracked for operations and profit, and stay out of {ownCompanyName}&apos;s sales, Books and
        tax. A business is never deleted — switch it off instead; its records keep the label.
      </p>

      {businesses.length === 0 ? (
        <p className="small faint">No other businesses yet. Until you add one, every transaction belongs to {ownCompanyName}.</p>
      ) : (
        businesses.map((row) => <BusinessRowForm key={row.id} row={row} saveAction={saveAction} toggleAction={toggleAction} />)
      )}

      <form onSubmit={add.onSubmit} style={{ borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 12, marginTop: 6 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
          Add a business
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="small" style={{ flex: "2 1 220px" }}>
            Business name
            <input name="name" placeholder="e.g. Example Trading Corp." />
            {e.name && <span className="field-error">{e.name}</span>}
          </label>
          <label className="small" style={{ flex: "1 1 110px" }}>
            Short label
            <input name="shortLabel" placeholder="e.g. ETC" />
            {e.shortLabel && <span className="field-error">{e.shortLabel}</span>}
          </label>
          <button className="btn" type="submit" disabled={add.pending}>
            {add.pending ? "Adding…" : "Add business"}
          </button>
        </div>
        {add.state.message && (
          <div className={`alert ${add.state.ok ? "ok" : "error"}`} role="status">
            {add.state.message}
          </div>
        )}
      </form>
    </div>
  );
}
