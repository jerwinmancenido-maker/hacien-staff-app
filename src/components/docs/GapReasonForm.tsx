"use client";

// Reconciliation note (PR-C, 2026-11-19): record WHY this order has no
// billing / supplier bill yet — a fact about the document ("Customer did
// not request an invoice", "Supplier did not issue an invoice", …). It
// shows on the Books → Reconciliation lists and changes nothing else:
// no total, no Book entry, no print.

import { useFormAction } from "@/components/useFormAction";
import { PO_GAP_REASONS, SO_GAP_REASONS } from "@/lib/reconciliation-shared";
import type { FormState } from "@/lib/validation/forms";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export function GapReasonForm({
  kind,
  currentCode,
  currentNote,
  action,
  partial = false,
}: {
  kind: "SO" | "PO";
  currentCode: string | null;
  currentNote: string | null;
  action: Action;
  /** E7: some billing/bill already exists — ask about the remainder, not "none yet". */
  partial?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const reasons = kind === "SO" ? SO_GAP_REASONS : PO_GAP_REASONS;
  const e = state.fieldErrors ?? {};
  const question =
    kind === "SO"
      ? partial
        ? "Why isn't the rest billed yet? (reconciliation note)"
        : "Why is there no billing yet? (reconciliation note)"
      : partial
        ? "Why isn't the rest billed by the supplier yet? (reconciliation note)"
        : "Why is there no supplier bill yet? (reconciliation note)";
  return (
    <form onSubmit={onSubmit} className="card" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="small" style={{ flex: "1 1 240px" }}>
          {question}
          <select name="gapReasonCode" defaultValue={currentCode ?? ""}>
            <option value="">— No reason recorded —</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          {e.gapReasonCode && <div className="error">{e.gapReasonCode}</div>}
        </label>
        <label className="small" style={{ flex: "2 1 280px" }}>
          Note
          <input name="gapNote" type="text" defaultValue={currentNote ?? ""} maxLength={2000} autoComplete="off" />
          {e.gapNote && <div className="error">{e.gapNote}</div>}
        </label>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save note"}
        </button>
      </div>
      <div className="small faint" style={{ marginTop: 6 }}>
        Shown on Books → Reconciliation. It records a fact about the document only — it changes no total and no filing
        figure.
      </div>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
    </form>
  );
}
