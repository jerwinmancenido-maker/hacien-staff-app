"use client";

import { useActionState } from "react";
import { markAccessReviewedAction } from "./actions";
import { accessReviewDue, accessReviewLabel } from "@/lib/access-review";

/** S-58: quarterly access review reminder. Admin checks the user list, then records the review. */
export function AccessReviewCard({ lastReviewedAt }: { lastReviewedAt: Date | null }) {
  const [state, action, pending] = useActionState(markAccessReviewedAction, {});
  const due = accessReviewDue(lastReviewedAt);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="label">Access review</div>
      <p>
        Last review: {accessReviewLabel(lastReviewedAt)}. {due ? "Review who can sign in and with which roles, then mark it reviewed." : "Next review is due after 90 days."}
      </p>
      <form action={action}>
        {state.message && (
          <p className="small" role="status">
            {state.message}
          </p>
        )}
        <button className="btn btn-secondary" type="submit" disabled={pending}>
          {pending ? "Recording…" : "Mark access reviewed today"}
        </button>
      </form>
    </div>
  );
}
