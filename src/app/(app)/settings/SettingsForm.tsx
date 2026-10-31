"use client";

// A settings section form. Saving asks "Change <setting>?" first, then creates
// a new settings version on the server.

import { useRef, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FormState } from "@/lib/validation/forms";

export type FieldSpec = {
  name: string;
  label: string;
  kind: "number" | "text" | "checkbox" | "lines" | "textarea" | "select" | "hidden";
  value: string | number | boolean | string[];
  hint?: string;
  prefix?: string;
  suffix?: string;
  full?: boolean;
  group?: string;
  /** Options for kind=select. */
  options?: { value: string; label: string }[];
};

export function SettingsForm({
  title,
  label,
  fields,
  versionId,
  action,
  showDocumentsOnlyFooter = true,
}: {
  title: string;
  /** Used in the confirm question: "Change {label}?" */
  label: string;
  fields: FieldSpec[];
  /** Settings version the form was rendered from; refreshed after each save. */
  versionId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** Hide on Tax calendar (not document settings). Default true. */
  showDocumentsOnlyFooter?: boolean;
}) {
  const { state, pending, submit } = useFormAction(action);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};

  const valueOf = (f: FieldSpec) => {
    const echoed = state.values?.[f.name];
    if (echoed !== undefined) return echoed;
    return Array.isArray(f.value) ? f.value.join("\n") : String(f.value);
  };

  return (
    <div className="card">
      <h2>{title}</h2>
      <form
        ref={formRef}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          setConfirming(true);
        }}
      >
        {state.message && (
          <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
            {state.message}
          </div>
        )}
        <input type="hidden" name="baseVersionId" value={versionId} />
        <div className="form-grid">
          {fields.map((f, i) => {
            if (f.kind === "hidden") {
              return <input key={f.name} type="hidden" name={f.name} value={valueOf(f)} />;
            }
            const groupHeader = f.group && f.group !== fields[i - 1]?.group ? <h3 className="section-title">{f.group}</h3> : null;
            const err = e[f.name];
            const control =
              f.kind === "checkbox" ? (
                <label className="check" htmlFor={f.name}>
                  <input type="hidden" name={f.name} value="false" />
                  <input id={f.name} name={f.name} type="checkbox" value="true" defaultChecked={state.values?.[f.name] ? state.values[f.name] === "true" : !!f.value} />
                  {f.label}
                </label>
              ) : f.kind === "lines" || f.kind === "textarea" ? (
                <textarea id={f.name} name={f.name} defaultValue={valueOf(f)} rows={f.kind === "lines" ? 8 : 3} />
              ) : f.kind === "select" ? (
                <select id={f.name} name={f.name} defaultValue={valueOf(f)}>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {f.prefix && <span className="muted">{f.prefix}</span>}
                  <input id={f.name} name={f.name} type={f.kind === "number" ? "number" : "text"} step="any" defaultValue={valueOf(f)} />
                  {f.suffix && <span className="muted">{f.suffix}</span>}
                </div>
              );
            return (
              <div key={f.name} style={{ display: "contents" }}>
                {groupHeader}
                <div className={`field${err ? " has-error" : ""}${f.full || f.kind === "lines" || f.kind === "textarea" ? " full" : ""}`}>
                  {f.kind !== "checkbox" && <label htmlFor={f.name}>{f.label}</label>}
                  {f.kind === "checkbox" && <span className="label">&nbsp;</span>}
                  {control}
                  {err ? (
                    <div className="error" role="alert">
                      {err}
                    </div>
                  ) : (
                    f.hint && <div className="hint">{f.hint}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="form-actions">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          {showDocumentsOnlyFooter && (
            <span className="small faint">Changes apply to new documents only.</span>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title={`Change ${label}?`}
        body="This saves a new settings version. Documents already made keep the old values."
        confirmLabel="Save changes"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (formRef.current) submit(formRef.current);
        }}
      />
    </div>
  );
}
