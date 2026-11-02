"use client";

import { useActionState, useState } from "react";
import { changePasswordAction } from "@/app/auth-actions";
import { Field } from "@/components/Field";

function PasswordField({
  label,
  name,
  autoComplete,
  autoFocus,
  error,
}: {
  label: string;
  name: string;
  autoComplete: string;
  autoFocus?: boolean;
  error?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} name={name} error={error}>
      <span className="password-field">
        <input id={name} name={name} type={shown ? "text" : "password"} autoComplete={autoComplete} autoFocus={autoFocus} />
        <button
          type="button"
          className="password-toggle"
          aria-pressed={shown}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setShown((open) => !open)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </Field>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <form className="password-form" action={action} noValidate>
      {state.message && (
        <p className={state.ok ? undefined : "alert error"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
      <PasswordField label="Current password" name="current" autoComplete="current-password" autoFocus error={state.fieldErrors?.current} />
      <PasswordField label="New password" name="password" autoComplete="new-password" error={state.fieldErrors?.password} />
      <PasswordField label="Type it again" name="confirm" autoComplete="new-password" error={state.fieldErrors?.confirm} />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
