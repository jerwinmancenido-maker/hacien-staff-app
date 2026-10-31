"use client";

// Settings → Numbering: compact table (doc | restart yearly | prefix | digits | example).

import { useRef, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FormState } from "@/lib/validation/forms";
import { NUMBERED_DOCS } from "@/lib/settings/form";
import { formatDocNumber } from "@/lib/settings/numbering";
import type { Settings } from "@/lib/settings/schema";

type Numbering = Settings["numbering"];

export function NumberingForm({
  label,
  versionId,
  action,
  numbering,
  taxYear,
}: {
  label: string;
  versionId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  numbering: Numbering;
  taxYear: number;
}) {
  const { state, pending, submit } = useFormAction(action);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};

  const strVal = (name: string, fallback: string | number) => {
    const echoed = state.values?.[name];
    if (echoed !== undefined) return echoed;
    return String(fallback);
  };

  return (
    <div className="card settings-section">
      <h2 className="settings-section-title">Numbering</h2>
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
        <div className="numbering-settings-wrap">
          <table className="numbering-settings-table">
            <thead>
              <tr>
                <th scope="col">Doc type</th>
                <th scope="col">Restart yearly</th>
                <th scope="col">Prefix</th>
                <th scope="col">Number length (digits)</th>
                <th scope="col">Example</th>
              </tr>
            </thead>
            <tbody>
              {NUMBERED_DOCS.map((d) => {
                const f = numbering[d.key];
                const prefixName = `${d.key}.prefix`;
                const paddingName = `${d.key}.padding`;
                const resetName = `${d.key}.resetYearly`;
                const prefix = strVal(prefixName, f.prefix);
                const paddingRaw = strVal(paddingName, f.padding);
                const padding = Number(paddingRaw) || f.padding;
                const example = formatDocNumber(
                  { prefix: prefix.toUpperCase() || f.prefix, padding },
                  taxYear,
                  1,
                );
                return (
                  <tr key={d.key} data-doc={d.key}>
                    <td className="numbering-doc" data-label="Doc type">
                      <span className="strong">{d.label}</span>
                    </td>
                    <td className="numbering-reset-cell" data-label="Restart yearly">
                      <label className="check numbering-reset" htmlFor={resetName}>
                        <input type="hidden" name={resetName} value="false" />
                        <input
                          id={resetName}
                          name={resetName}
                          type="checkbox"
                          value="true"
                          aria-label={`Restart ${d.label} counter every year`}
                          defaultChecked={
                            state.values?.[resetName] !== undefined
                              ? state.values[resetName] === "true"
                              : !!f.resetYearly
                          }
                        />
                        <span className="numbering-reset-text">Restart yearly</span>
                      </label>
                    </td>
                    <td className={`numbering-prefix${e[prefixName] ? " has-error" : ""}`} data-label="Prefix">
                      <label className="numbering-field-label" htmlFor={prefixName}>
                        Prefix
                      </label>
                      <input
                        id={prefixName}
                        name={prefixName}
                        type="text"
                        defaultValue={prefix}
                        autoCapitalize="characters"
                      />
                      {e[prefixName] && (
                        <div className="error" role="alert">
                          {e[prefixName]}
                        </div>
                      )}
                    </td>
                    <td className={`numbering-digits${e[paddingName] ? " has-error" : ""}`} data-label="Number length (digits)">
                      <label className="numbering-field-label" htmlFor={paddingName}>
                        Number length (digits)
                      </label>
                      <input
                        id={paddingName}
                        name={paddingName}
                        type="number"
                        min={1}
                        max={8}
                        step="1"
                        defaultValue={paddingRaw}
                      />
                      {e[paddingName] && (
                        <div className="error" role="alert">
                          {e[paddingName]}
                        </div>
                      )}
                    </td>
                    <td className="numbering-example" data-label="Example">
                      <code className="numbering-example-code">{example}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="form-actions settings-form-actions">
          <span className="small faint settings-form-footnote">Changes apply to new documents only.</span>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
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
