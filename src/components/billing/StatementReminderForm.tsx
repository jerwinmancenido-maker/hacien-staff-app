"use client";

import { useFormAction } from "../useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { formatDateTime } from "@/lib/format";

/**
 * Phase 3 #9: "Email statement" block on the customer Balances tab.
 * When email is not configured on this server the block says so and
 * offers no send button (scenario E1 — that state is the staging proof).
 */
export function StatementReminderForm({
  configured,
  recipient,
  lastSentAt,
  action,
}: {
  configured: boolean;
  recipient: string | null;
  lastSentAt: string | null;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <div style={{ marginTop: 12 }}>
      {!configured ? (
        <p className="small faint">Email is not configured on this server, so statement reminders cannot be sent yet.</p>
      ) : !recipient ? (
        <p className="small faint">No email address on file for this customer — add one to a contact to send a statement reminder.</p>
      ) : (
        <form onSubmit={onSubmit}>
          <div className="form-actions">
            <button className="btn btn-secondary" type="submit" disabled={pending}>
              Email statement to {recipient}
            </button>
            {lastSentAt ? (
              <span className="small faint">Last sent {formatDateTime(new Date(lastSentAt))}</span>
            ) : null}
          </div>
          {state.message ? (
            <p className="small" role="status">
              {state.message}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
