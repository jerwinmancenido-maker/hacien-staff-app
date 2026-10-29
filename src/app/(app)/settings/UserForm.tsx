"use client";

import { useFormAction } from "@/components/useFormAction";
import type { User } from "@prisma/client";
import { Field } from "@/components/Field";
import { ROLE_LABELS, ROLES, rolesOf } from "@/lib/permissions";
import type { FormState } from "@/lib/validation/forms";

const ROLE_HINTS = {
  ADMIN: "Everything, including Settings and users",
  APPROVER: "Approves deals, edits data",
  STAFF: "Edits data",
  VIEWER: "Read-only",
} as const;

export function UserForm({ user, action }: { user: User | null; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const current = user ? rolesOf(user) : ["STAFF"];
  return (
    <form onSubmit={onSubmit} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <div className="form-grid">
        <Field label="Name" name="name" required error={e.name}>
          <input id="name" name="name" type="text" defaultValue={state.values?.name ?? user?.name} />
        </Field>
        <Field label="Email" name="email" required error={e.email}>
          <input id="email" name="email" type="email" defaultValue={state.values?.email ?? user?.email} />
        </Field>
        <div className={`field full${e.roles ? " has-error" : ""}`}>
          <span className="label">Roles</span>
          <div style={{ display: "grid", gap: 8 }}>
            {ROLES.map((r) => (
              <label key={r} className="check">
                <input type="checkbox" name="roles" value={r} defaultChecked={current.includes(r)} />
                <span>
                  <b>{ROLE_LABELS[r]}</b> <span className="muted small">— {ROLE_HINTS[r]}</span>
                </span>
              </label>
            ))}
          </div>
          {e.roles && <div className="error">{e.roles}</div>}
        </div>
        <div className="field full">
          <label className="check">
            <input type="checkbox" name="canSeeCosts" defaultChecked={user?.canSeeCosts ?? false} />
            <span>
              <b>Can see costs</b> <span className="muted small">— supplier costs and margins</span>
            </span>
          </label>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : user ? "Save" : "Add user and send invite"}
        </button>
      </div>
    </form>
  );
}
