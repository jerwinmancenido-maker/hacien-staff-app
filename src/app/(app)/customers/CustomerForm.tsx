"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { Address, Customer } from "@prisma/client";
import { formatAddress } from "@/lib/addresses/format";
import { ADDRESS_KIND_LABELS } from "@/lib/validation/addresses";
import { Field } from "@/components/Field";
import { BIR2303Upload } from "@/components/customers/BIR2303Upload";
import type { Prefill } from "@/lib/2303/prefill";
import { WithholdingPickField } from "@/components/WithholdingPickField";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import { defaultWithholdingPickFor, parseWithholdingPick } from "@/lib/quotes/withholding-defaults";
import {
  WITHHOLDING_TYPE_FIELD_LABEL,
  WITHHOLDING_TYPE_FORM_LABELS,
  WITHHOLDING_TYPE_FORM_ORDER,
  withholdingTypeFieldHint,
} from "@/lib/withholding/display";
import type { FormState } from "@/lib/validation/forms";

function typeIsYes(type: string): boolean {
  return type === "GOVERNMENT" || type === "TOP_WITHHOLDING_AGENT";
}

export function CustomerForm({
  customer,
  terms,
  rates,
  action,
  canEdit,
  canSeeTin = true,
  canEditWithholding = true,
  addresses,
}: {
  customer: Customer | null;
  terms: string[];
  /** Active Settings → Withholding rates staff may tick. */
  rates: WithholdingSnapshot[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  canEdit: boolean;
  /** S-58: false blanks the TIN field (view-only users). */
  canSeeTin?: boolean;
  /** Existing customers: only Admin may change withholding type/rates. */
  canEditWithholding?: boolean;
  addresses?: Address[];
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const v = (k: keyof Customer) => state.values?.[k] ?? (customer?.[k] as string | null) ?? "";
  const [name, setName] = useState(v("name"));
  const [tin, setTin] = useState(canSeeTin ? v("tin") : "");
  const [notes, setNotes] = useState(v("notes"));
  const [street, setStreet] = useState(state.values?.street ?? "");
  const [barangay, setBarangay] = useState(state.values?.barangay ?? "");
  const [cityMunicipality, setCityMunicipality] = useState(state.values?.cityMunicipality ?? "");
  const [province, setProvince] = useState(state.values?.province ?? "");
  const [zip, setZip] = useState(state.values?.zip ?? "");
  const [withholding, setWithholding] = useState(v("withholdingType"));
  // Modular terms: "business" (default) prints point 6 on quotes;
  // "individual" (private individual, personal use) omits it.
  const [customerKind, setCustomerKind] = useState(
    state.values?.customerKind ?? (customer?.isIndividual ? "individual" : "business"),
  );
  const initialPick =
    state.values?.defaultWithholding !== undefined
      ? parseWithholdingPick(state.values.defaultWithholding)
      : parseWithholdingPick(customer?.defaultWithholding);
  const [pick, setPick] = useState<string[] | null>(() => {
    // "No" always means explicit none [].
    if (v("withholdingType") === "NONE") return [];
    return initialPick;
  });
  const e = state.fieldErrors ?? {};
  const termOptions = customer?.defaultTerms && !terms.includes(customer.defaultTerms) ? [...terms, customer.defaultTerms] : terms;
  // Blank stays blank. Do not invent the first list item for a customer who has no terms yet.
  const [defaultTerms, setDefaultTerms] = useState(state.values?.defaultTerms ?? customer?.defaultTerms ?? "");
  const termsRequired = !customer || Boolean(customer.defaultTerms?.trim());
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [isBilling, setIsBilling] = useState(true);
  const [isDelivery, setIsDelivery] = useState(true);
  // Add-address fields: always shown for a new customer; on an existing
  // customer they hide behind an "Add address" button. A failed save with
  // address errors, or a 2303 prefill that fills an address field, re-opens them.
  const [addAddressOpen, setAddAddressOpen] = useState(false);
  const hasSavedAddresses = addresses?.some((a) => !a.archivedAt) ?? false;
  const addressFieldErrors =
    e.street || e.barangay || e.cityMunicipality || e.province || e.zip ||
    e.deliveryStreet || e.deliveryBarangay || e.deliveryCityMunicipality ||
    e.deliveryProvince || e.deliveryZip;
  const showAddAddress =
    customer == null ||
    addAddressOpen ||
    Boolean((state.values?.street ?? "").trim()) ||
    Boolean(addressFieldErrors);

  // Blank withholding (type unset, or Yes with rates still null) blocks save — never silent "No".
  const withholdingBlank = !withholding || (typeIsYes(withholding) && pick == null);
  const blocked = !name.trim() || withholdingBlank || (termsRequired && !defaultTerms.trim());
  const showPick = typeIsYes(withholding);
  const withholdingLocked = !canEditWithholding;

  // BIR 2303 auto-fill: fill only fields staff left empty, never
  // overwrite what they already typed.
  function applyPrefill(prefill: Prefill) {
    if (prefill.name && !name.trim()) setName(prefill.name);
    if (prefill.tin && canSeeTin && !tin.trim()) setTin(prefill.tin);
    let filledAddress = false;
    if (prefill.street && !street.trim()) { setStreet(prefill.street); filledAddress = true; }
    if (prefill.barangay && !barangay.trim()) { setBarangay(prefill.barangay); filledAddress = true; }
    if (prefill.cityMunicipality && !cityMunicipality.trim()) { setCityMunicipality(prefill.cityMunicipality); filledAddress = true; }
    if (prefill.province && !province.trim()) { setProvince(prefill.province); filledAddress = true; }
    if (prefill.zip && !zip.trim()) { setZip(prefill.zip); filledAddress = true; }
    if (filledAddress) setAddAddressOpen(true);
    if (prefill.notes && !notes.trim()) setNotes(prefill.notes);
  }

  function onTypeChange(next: string) {
    setWithholding(next);
    // Existing customers keep the saved pick. The suggestion is for a new record only.
    if (customer) {
      if (next === "NONE") setPick([]);
      else if (!typeIsYes(next)) setPick(null);
      else if (pick != null && pick.length === 0) setPick(null);
      return;
    }
    const suggested = defaultWithholdingPickFor(next);
    setPick(suggested == null ? null : [...suggested]);
  }

  return (
    <form onSubmit={onSubmit} noValidate id="customer-form">
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        {!customer && <BIR2303Upload onPrefill={applyPrefill} />}
        <div className="form-grid">
          <Field label="Name" name="name" required error={e.name} full>
            <input id="name" name="name" type="text" value={name} onChange={(ev) => setName(ev.target.value)} />
          </Field>
          <Field label="TIN" name="tin" error={e.tin} hint="000-000-000-00000 · branch code optional (3 or 5 digits)">
            <input id="tin" name="tin" type="text" value={tin} onChange={(ev) => setTin(ev.target.value)} inputMode="numeric" placeholder="000-000-000-00000" maxLength={17} />
          </Field>
          <Field
            label="Customer type"
            name="customerKind"
            error={e.isIndividual}
            hint="Private individuals buying for personal use don't get the withholding-tax point on their quotes."
          >
            <select id="customerKind" name="customerKind" value={customerKind} onChange={(ev) => setCustomerKind(ev.target.value)}>
              <option value="business">Business / organisation / government</option>
              <option value="individual">Private individual — personal use</option>
            </select>
          </Field>
          <Field
            label={WITHHOLDING_TYPE_FIELD_LABEL}
            name="withholdingType"
            required
            error={e.withholdingType}
            hint={
              showPick
                ? (withholdingTypeFieldHint(withholding) ?? "Label only — rates are picked in Withholding below.")
                : withholding === "NONE"
                  ? "No withholding — rates are saved as none."
                  : "Label only — rates are picked in Withholding below."
            }
            full
          >
            <select
              id="withholdingType"
              name={withholdingLocked ? undefined : "withholdingType"}
              value={withholding}
              onChange={(ev) => onTypeChange(ev.target.value)}
              disabled={withholdingLocked}
            >
              <option value="">Pick one…</option>
              {WITHHOLDING_TYPE_FORM_ORDER.map((t) => (
                <option key={t} value={t}>
                  {WITHHOLDING_TYPE_FORM_LABELS[t]}
                </option>
              ))}
            </select>
            {/* Disabled selects are omitted from FormData — post the locked value explicitly. */}
            {withholdingLocked ? <input type="hidden" name="withholdingType" value={withholding} /> : null}
            {withholdingLocked ? <div className="hint">Only an Admin can change withholding on an existing customer.</div> : null}
          </Field>
          {showPick ? (
            <div className="field full">
              <WithholdingPickField
                rates={rates}
                value={pick}
                onChange={setPick}
                disabled={!canEdit || withholdingLocked}
                error={e.defaultWithholding}
              />
            </div>
          ) : (
            // Persist [] when type is No so the server never keeps a stale pick.
            <input type="hidden" name="defaultWithholdingJson" value={withholding === "NONE" ? "[]" : ""} />
          )}
          {withholdingBlank ? <div className="error">Pick a withholding type and rates (or No withholding) before saving.</div> : null}
          <Field label="Payment terms" name="defaultTerms" required error={e.defaultTerms}>
            <select id="defaultTerms" name="defaultTerms" value={defaultTerms} onChange={(ev) => setDefaultTerms(ev.target.value)}>
              <option value="">Pick payment terms…</option>
              {termOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Credit limit (₱)" name="creditLimit" error={e.creditLimit} hint="Blank = no limit. Warns when the balance due passes it; never blocks a quote.">
            <input id="creditLimit" name="creditLimit" type="text" inputMode="decimal" defaultValue={v("creditLimit") == null ? "" : String(v("creditLimit"))} placeholder="e.g. 500000" />
          </Field>
          <Field label="Notes" name="notes" error={e.notes} full>
            <textarea id="notes" name="notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={3} />
          </Field>
          <div className="field full">
            <label>
              <input
                type="checkbox"
                name="orderTextUpdates"
                defaultChecked={customer == null ? true : customer.orderTextUpdates}
              />{" "}
              Order text updates
            </label>
            <div className="hint">Send order-status texts (confirmed, delivered, payment received) to this customer. Off by default for the whole app until UniSMS is set up — see Messages.</div>
          </div>

          <div className="field full">
            <div className="label">Addresses</div>
            {hasSavedAddresses && (
              <ul className="plain-list">
                {addresses!.filter((a) => !a.archivedAt).map((a) => (
                  <li key={a.id}>
                    {ADDRESS_KIND_LABELS[a.kind]}
                    {a.isDefault ? " · Default" : ""}
                    {" — "}
                    {formatAddress(a)}
                  </li>
                ))}
              </ul>
            )}
            <div className="hint">
              {showAddAddress
                ? hasSavedAddresses
                  ? "Saved addresses stay as they are. Use the fields below to add another. One default billing and one default delivery."
                  : "Optional. Fill this in to save a billing address and a delivery address."
                : hasSavedAddresses
                  ? "Saved addresses stay as they are. One default billing and one default delivery."
                  : "No addresses saved yet."}
            </div>
            <input type="hidden" name="isBilling" value={isBilling ? "true" : "false"} />
            <input type="hidden" name="sameAsBilling" value={sameAsBilling ? "true" : "false"} />
            {showAddAddress ? (
              <div className="check-row">
                <label className="check">
                  <input type="checkbox" checked={isBilling} onChange={(ev) => setIsBilling(ev.target.checked)} />
                  Default billing address
                </label>
                <label className="check">
                  <input type="checkbox" checked={sameAsBilling} onChange={(ev) => setSameAsBilling(ev.target.checked)} />
                  Same as billing
                </label>
              </div>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setAddAddressOpen(true)}>
                Add address
              </button>
            )}
          </div>
          {showAddAddress && (
            <>
            <Field label="Unit / building / street" name="street" error={e.street} full>
              <textarea id="street" name="street" rows={2} value={street} onChange={(ev) => setStreet(ev.target.value)} placeholder="Unit 4B, Sample Tower, 12 Rizal St." />
            </Field>
            <Field label="Barangay" name="barangay" error={e.barangay}>
              <input id="barangay" name="barangay" type="text" value={barangay} onChange={(ev) => setBarangay(ev.target.value)} placeholder="San Antonio" />
            </Field>
            <Field label="City / municipality" name="cityMunicipality" error={e.cityMunicipality}>
              <input id="cityMunicipality" name="cityMunicipality" type="text" value={cityMunicipality} onChange={(ev) => setCityMunicipality(ev.target.value)} placeholder="Pasig" />
            </Field>
            <Field label="Province" name="province" error={e.province} hint="Metro Manila for NCR cities">
              <input id="province" name="province" type="text" value={province} onChange={(ev) => setProvince(ev.target.value)} placeholder="Metro Manila" />
            </Field>
            <Field label="ZIP code" name="zip" error={e.zip}>
              <input id="zip" name="zip" type="text" inputMode="numeric" maxLength={4} pattern="\d{4}" value={zip} onChange={(ev) => setZip(ev.target.value)} placeholder="1605" />
            </Field>

            {!sameAsBilling && (
              <>
                <div className="field full">
                  <div className="label">Delivery address</div>
                  <input type="hidden" name="isDelivery" value={isDelivery ? "true" : "false"} />
                  <label className="check">
                    <input type="checkbox" checked={isDelivery} onChange={(ev) => setIsDelivery(ev.target.checked)} />
                    Default delivery address
                  </label>
                </div>
                <Field label="Unit / building / street" name="deliveryStreet" error={e.deliveryStreet} full>
                  <textarea id="deliveryStreet" name="deliveryStreet" rows={2} defaultValue={state.values?.deliveryStreet ?? ""} placeholder="Warehouse 2, 88 Commerce Ave." />
                </Field>
                <Field label="Barangay" name="deliveryBarangay" error={e.deliveryBarangay}>
                  <input id="deliveryBarangay" name="deliveryBarangay" type="text" defaultValue={state.values?.deliveryBarangay ?? ""} placeholder="Manggahan" />
                </Field>
                <Field label="City / municipality" name="deliveryCityMunicipality" error={e.deliveryCityMunicipality}>
                  <input id="deliveryCityMunicipality" name="deliveryCityMunicipality" type="text" defaultValue={state.values?.deliveryCityMunicipality ?? ""} placeholder="Pasig" />
                </Field>
                <Field label="Province" name="deliveryProvince" error={e.deliveryProvince}>
                  <input id="deliveryProvince" name="deliveryProvince" type="text" defaultValue={state.values?.deliveryProvince ?? ""} placeholder="Metro Manila" />
                </Field>
                <Field label="ZIP code" name="deliveryZip" error={e.deliveryZip}>
                  <input id="deliveryZip" name="deliveryZip" type="text" inputMode="numeric" maxLength={4} pattern="\d{4}" defaultValue={state.values?.deliveryZip ?? ""} placeholder="1611" />
                </Field>
            </>
          )}
            </>
          )}
        </div>
        {canEdit && (
          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || blocked}>
              {pending ? "Saving…" : "Save"}
            </button>
            {blocked && (
              <span className="small faint">
                {termsRequired ? "Name, payment terms, and customer type are required." : "Name and customer type are required."}
              </span>
            )}
          </div>
        )}
      </fieldset>
    </form>
  );
}
