"use client";

import { useActionState } from "react";
import { resetPassword } from "../auth-actions";
import { Field } from "@/components/Field";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, {});
  return (
    <form action={action} noValidate>
      {state.message && (
        <div className="alert error" role="alert">
          {state.message}
        </div>
      )}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" error={state.fieldErrors?.password}>
        <input id="password" name="password" type="password" autoComplete="new-password" autoFocus />
      </Field>
      <Field label="Type it again" name="confirm" error={state.fieldErrors?.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
