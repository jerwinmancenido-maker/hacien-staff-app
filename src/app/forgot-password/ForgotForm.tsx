"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword } from "../auth-actions";
import { Field } from "@/components/Field";

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPassword, {});
  return (
    <form action={action} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <Field label="Email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" autoComplete="username" autoFocus />
      </Field>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <div className="links">
        <Link href="/login">Back to sign in</Link>
      </div>
    </form>
  );
}
