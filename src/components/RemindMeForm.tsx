"use client";

import { useFormAction } from "./useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { Field } from "./Field";
import type { ReminderTarget } from "@/lib/services/reminders";

/** S-56: small "Remind me" form for quote / SO / PO pages. Personal to the staff member who sets it. */
export function RemindMeForm({
  entityType,
  entityId,
  action,
}: {
  entityType: ReminderTarget;
  entityId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="card">
      <div className="card-head">
        <h2>Remind me</h2>
      </div>
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <div className="form-grid">
        <Field label="Remind on" name="remindAt" error={e.remindAt} required>
          <input id="remindAt" name="remindAt" type="date" required />
        </Field>
        <Field label="Note" name="note" error={e.note} full required>
          <input id="note" name="note" type="text" maxLength={500} placeholder="e.g. Follow up the buyer PO" />
        </Field>
      </div>
      {state.message ? (
        <p className="small" role="status">
          {state.message}
        </p>
      ) : null}
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          Set reminder
        </button>
        <span className="small faint">Only you see your reminders, on the Reminders page.</span>
      </div>
    </form>
  );
}
