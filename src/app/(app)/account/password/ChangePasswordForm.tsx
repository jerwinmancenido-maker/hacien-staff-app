"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/auth-actions";
import { Field } from "@/components/Field";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={action} noValidate>
      {state.message && (
        <div className={state.ok ? "alert ok" : "alert error"} role="alert">
          {state.message}
        </div>
      )}
      <Field label="Current password" name="current" error={state.fieldErrors?.current}>
        <input id="current" name="current" type="password" autoComplete="current-password" autoFocus />
      </Field>
      <Field label="New password" name="password" error={state.fieldErrors?.password}>
        <input id="password" name="password" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Type it again" name="confirm" error={state.fieldErrors?.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
