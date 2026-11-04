"use client";

import { useActionState } from "react";
import { verifyTwoFactor } from "../../auth-actions";
import { Field } from "@/components/Field";

/** S-58: second sign-in step — code from the user's authenticator app. */
export function LoginVerifyForm() {
  const [state, action, pending] = useActionState(verifyTwoFactor, {});
  return (
    <form action={action} noValidate>
      {state.message && (
        <div className="alert error" role="alert">
          {state.message}
        </div>
      )}
      <Field label="Authenticator code" name="code" error={state.fieldErrors?.code}>
        <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus />
      </Field>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Checking…" : "Verify and sign in"}
      </button>
    </form>
  );
}
