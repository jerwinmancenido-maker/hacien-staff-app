"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { Item } from "@prisma/client";
import { Field } from "@/components/Field";
import { ITEM_KINDS, ITEM_KIND_LABELS } from "@/lib/validation/items";
import type { FormState } from "@/lib/validation/forms";

export function ItemForm({
  item,
  action,
  canEdit,
}: {
  item: Item | null;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  canEdit: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const v = (k: keyof Item) => state.values?.[k] ?? (item?.[k] as string | null) ?? "";
  const [name, setName] = useState(v("name"));
  const e = state.fieldErrors ?? {};
  const priceDefault = state.values?.defaultUnitPrice ?? (item?.defaultUnitPrice ? item.defaultUnitPrice.toString() : "");

  return (
    <form onSubmit={onSubmit} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Name" name="name" required error={e.name} full>
            <input id="name" name="name" type="text" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Anthropic Claude Max 5x Plan" />
          </Field>
          <Field label="Kind" name="kind" required error={e.kind}>
            <select id="kind" name="kind" defaultValue={v("kind") || "GOODS"}>
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ITEM_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unit" name="unit" required error={e.unit}>
            <input id="unit" name="unit" type="text" defaultValue={v("unit") || "pc"} placeholder="pc" />
          </Field>
          <Field label="Brand" name="brand" error={e.brand}>
            <input id="brand" name="brand" type="text" defaultValue={v("brand")} placeholder="Anthropic" />
          </Field>
          <Field label="Model" name="model" error={e.model}>
            <input id="model" name="model" type="text" defaultValue={v("model")} placeholder="Claude Max 5x" />
          </Field>
          <Field label="Category" name="category" error={e.category}>
            <input id="category" name="category" type="text" defaultValue={v("category")} placeholder="Software" />
          </Field>
          <Field label="SKU / part no." name="sku" error={e.sku}>
            <input id="sku" name="sku" type="text" defaultValue={v("sku")} />
          </Field>
          <Field label="Default unit price" name="defaultUnitPrice" error={e.defaultUnitPrice} hint="Optional — the quote line starts from this price.">
            <input
              id="defaultUnitPrice"
              name="defaultUnitPrice"
              type="text"
              inputMode="decimal"
              defaultValue={priceDefault}
              placeholder="0.00"
            />
          </Field>
          <Field label="Details" name="details" error={e.details} full>
            <textarea id="details" name="details" defaultValue={v("details")} rows={3} placeholder="12 months" />
          </Field>
        </div>
        {canEdit && (
          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save"}
            </button>
            {!name.trim() && <span className="small faint">Name is required.</span>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
