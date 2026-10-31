"use client";

// Multi-select of active Settings → Withholding rates for a customer or quote.
// Staff can tick one or more rates (combined). Empty + notSetAllowed = "not set"
// until they confirm "Yes, none" or tick rates.

import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import { ratePctLabel } from "@/lib/quotes/calc";
import {
  WITHHOLDING_PICK_FIELD_HINT,
  WITHHOLDING_PICK_FIELD_LABEL,
  WITHHOLDING_PICK_NONE_LABEL,
  WITHHOLDING_PICK_RESET_LABEL,
} from "@/lib/quotes/withholding-defaults";

const LINE_KIND_LABEL: Record<string, string> = {
  GOODS: "Goods lines",
  SERVICES: "Services lines",
  GOV_PT: "Whole total",
  GOV_VAT: "Whole total",
};

export type WithholdingPickFieldProps = {
  id?: string;
  name?: string;
  rates: WithholdingSnapshot[];
  /** null = not set; [] = none; [codes] = picks. */
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
  error?: string;
  /** When true, clearing every tick returns null (not set) instead of []. */
  clearToNotSet?: boolean;
  hint?: string;
  label?: string;
  /** When false, hide the field label (parent shows a collapsed summary). */
  showLabel?: boolean;
};

export function WithholdingPickField({
  id = "withholdingPick",
  name = "defaultWithholding",
  rates,
  value,
  onChange,
  disabled,
  error,
  clearToNotSet = true,
  hint = WITHHOLDING_PICK_FIELD_HINT,
  label = WITHHOLDING_PICK_FIELD_LABEL,
  showLabel = true,
}: WithholdingPickFieldProps) {
  const selected = new Set(value ?? []);

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    if (next.size === 0) {
      onChange(clearToNotSet ? null : []);
      return;
    }
    onChange([...next]);
  }

  function setNone() {
    onChange([]);
  }

  return (
    <div className={`field${error ? " has-error" : ""}`} id={id}>
      {showLabel ? <span className="label">{label}</span> : null}
      <div className="wh-pick-list" role="group" aria-label={label}>
        {rates.length === 0 ? (
          <span className="small faint">No active rates in Settings → Withholding.</span>
        ) : (
          rates.map((r) => {
            // Labels already include the ATC — don't double it.
            const atc = r.atcCode && !r.label.includes(r.atcCode) ? r.atcCode : null;
            return (
              <label key={r.code} className="wh-pick-row">
                <input
                  type="checkbox"
                  name={name}
                  value={r.code}
                  checked={selected.has(r.code)}
                  disabled={disabled}
                  onChange={() => toggle(r.code)}
                />
                <span>
                  {r.label}
                  {atc ? ` (${atc})` : ""} · {ratePctLabel(r.rate)} · {LINE_KIND_LABEL[r.lineKind] ?? r.lineKind}
                </span>
              </label>
            );
          })
        )}
      </div>
      <div className="wh-pick-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <button type="button" className="btn-link" disabled={disabled || (value != null && value.length === 0)} onClick={setNone}>
          {WITHHOLDING_PICK_NONE_LABEL}
        </button>
        {clearToNotSet && value != null && (
          <button type="button" className="btn-link" disabled={disabled} onClick={() => onChange(null)}>
            {WITHHOLDING_PICK_RESET_LABEL}
          </button>
        )}
      </div>
      {/* Hidden input so classic form posts can read the JSON pick. */}
      <input type="hidden" name={`${name}Json`} value={value == null ? "" : JSON.stringify(value)} />
      {error ? <div className="error">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
