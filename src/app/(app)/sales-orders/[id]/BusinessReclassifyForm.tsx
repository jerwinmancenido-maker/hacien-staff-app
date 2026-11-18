"use client";

// Admin-only: change which business a sales order belongs to
// (Reconciliation Plan 2026-11-19). The service refuses once the order has
// live billing; the order's POs and linked expenses follow.

import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export function BusinessReclassifyForm({
  ownCompanyName,
  currentBusinessId,
  businesses,
  action,
}: {
  ownCompanyName: string;
  currentBusinessId: string | null;
  businesses: { id: string; name: string; active: boolean }[];
  action: Action;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="card" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="small" style={{ flex: "1 1 240px" }}>
          Business this order belongs to (Admin only)
          <select name="businessId" defaultValue={currentBusinessId ?? ""}>
            <option value="">{ownCompanyName} (own company)</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id} disabled={!b.active && b.id !== currentBusinessId}>
                {b.name}
                {b.active ? "" : " (switched off)"}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change business"}
        </button>
      </div>
      <div className="small faint" style={{ marginTop: 6 }}>
        The order&apos;s purchase orders and linked expenses move with it. Not possible once billing is recorded.
      </div>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
    </form>
  );
}
