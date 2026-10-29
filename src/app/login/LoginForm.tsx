"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "../auth-actions";
import { Field } from "@/components/Field";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} noValidate>
      {state.message && (
        <div className="alert error" role="alert">
          {state.message}
        </div>
      )}
      <Field label="Email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" autoComplete="username" defaultValue={state.values?.email} autoFocus />
      </Field>
      <Field label="Password" name="password" error={state.fieldErrors?.password}>
        <input id="password" name="password" type="password" autoComplete="current-password" />
      </Field>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <div className="links">
        <Link href="/forgot-password">Forgot password</Link>
      </div>
    </form>
  );
}
