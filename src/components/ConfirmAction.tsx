"use client";

// A button that asks for confirmation, then runs a server action.
// Used for Mark inactive / Turn off / Make main. Shows the action's error, if any.

import { useActionState, useRef, useState } from "react";
import type { FormState } from "@/lib/validation/forms";
import { ConfirmDialog } from "./ConfirmDialog";

export function ConfirmAction({
  action,
  label,
  title,
  body,
  confirmLabel,
  danger,
  small,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  label: string;
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  small?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={formAction} data-no-row-click style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {state.message && !state.ok && (
        <span role="alert" className="small" style={{ color: "var(--red)" }}>
          {state.message}
        </span>
      )}
      <button
        type="button"
        className={`btn ${danger ? "btn-danger" : "btn-secondary"}${small ? " btn-sm" : ""}`}
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        body={body}
        confirmLabel={confirmLabel ?? label}
        danger={danger}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          formRef.current?.requestSubmit();
        }}
      />
    </form>
  );
}
