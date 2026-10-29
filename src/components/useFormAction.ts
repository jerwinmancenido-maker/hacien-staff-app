"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { FormState } from "@/lib/validation/forms";

/**
 * useActionState, submitted from onSubmit instead of <form action>.
 * React resets a form after an `action` submit, which wipes what the user typed
 * when the server returns a validation error; this keeps the inputs as they are.
 */
export function useFormAction(action: (state: FormState, form: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useActionState(action, {});
  const submit = (form: HTMLFormElement) => startTransition(() => dispatch(new FormData(form)));
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit(e.currentTarget);
  };
  return { state, pending, onSubmit, submit };
}
