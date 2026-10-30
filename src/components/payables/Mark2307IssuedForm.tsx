"use client";

import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";

export function Mark2307IssuedForm({
  action,
  defaultDate,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaultDate: string;
}) {
  const { state, pending, submit } = useFormAction(action);
  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        submit(ev.currentTarget);
      }}
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
    >
      <input name="issuedAt" type="date" className="input" defaultValue={defaultDate} required style={{ width: 140 }} />
      <input name="files" type="file" accept=".pdf,.png,.jpg,.jpeg" />
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "…" : "Mark issued"}
      </button>
      {state.message && <span className={`small ${state.ok ? "ok" : "error"}`}>{state.message}</span>}
    </form>
  );
}
