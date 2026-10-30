"use client";

// "Addresses" section on the customer / supplier Details tab: cards like
// ContactCards, with add / edit (modal form), make default, archive / restore.
// The server re-checks every action and writes the audit rows.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Address } from "@prisma/client";
import { formatAddress } from "@/lib/addresses/format";
import { PH_CITIES, PH_PROVINCES } from "@/lib/addresses/ph-places";
import { ADDRESS_KIND_LABELS, ADDRESS_KINDS } from "@/lib/validation/addresses";
import { makeDefaultAddressAction, saveAddressAction, setAddressArchivedAction } from "@/app/(app)/addresses/actions";
import type { FormState } from "@/lib/validation/forms";
import { Field } from "./Field";
import { Chip } from "./ui";
import { PlusIcon } from "./Icons";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { Modal } from "./docs/Dialogs";
import { useFormAction } from "./useFormAction";

export type AddressCardsProps = {
  addresses: Address[];
  ownerKind: "customer" | "supplier";
  ownerId: string;
  canEdit: boolean;
};

export function AddressCards({ addresses, ownerKind, ownerId, canEdit }: AddressCardsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const active = addresses.filter((a) => !a.archivedAt);
  const archived = addresses.filter((a) => a.archivedAt);
  const missingMain = ownerKind === "supplier" && !active.some((a) => a.kind === "OFFICE" || a.kind === "BILLING");

  const run = (fn: () => Promise<FormState>) =>
    startTransition(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.message ?? "Something went wrong."));
      router.refresh();
    });

  const card = (a: Address) => {
    const menu: RowMenuItem[] = [];
    if (canEdit && !a.archivedAt) {
      menu.push({ label: "Edit", onClick: () => setEditing(a) });
      if (!a.isDefault) menu.push({ label: isPending ? "Updating…" : `Make default ${ADDRESS_KIND_LABELS[a.kind].toLowerCase()}`, onClick: () => run(() => makeDefaultAddressAction(a.id)) });
      menu.push({ label: isPending ? "Updating…" : "Archive", danger: true, onClick: () => run(() => setAddressArchivedAction(a.id, true)) });
    }
    if (canEdit && a.archivedAt) menu.push({ label: isPending ? "Updating…" : "Restore", onClick: () => run(() => setAddressArchivedAction(a.id, false)) });
    return (
      <div key={a.id} className={`contact-card address-card${a.archivedAt ? " inactive" : ""}`}>
        <div className="contact-card-top">
          <div className="contact-card-name">
            <Chip tone={a.kind === "BILLING" || a.kind === "OFFICE" ? "dark" : "grey"}>{ADDRESS_KIND_LABELS[a.kind]}</Chip>
            {a.isDefault && <Chip tone="green">Default</Chip>}
            {a.needsReview && <Chip tone="amber">Needs review</Chip>}
            {a.archivedAt && <Chip tone="red">Archived</Chip>}
            {a.label && <span className="address-label">{a.label}</span>}
          </div>
          {menu.length > 0 && <RowMenu items={menu} ariaLabel="Address actions" />}
        </div>
        <div className="address-text">{formatAddress(a, { multiline: true })}</div>
        {a.needsReview && (
          <div className="small faint">Copied from the old address field. Edit it to fill in barangay, city, province and ZIP.</div>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Addresses ({active.length})</h2>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {missingMain && (
        <div className="alert warn" role="status">
          Add an office or billing address for this supplier.
        </div>
      )}
      <div className="contact-grid">
        {active.map(card)}
        {canEdit && (
          <button type="button" className="contact-card-add address-add" onClick={() => setEditing("new")}>
            <PlusIcon size={18} />
            <span>Add address</span>
          </button>
        )}
      </div>
      {active.length === 0 && !canEdit && <div className="faint small">No addresses yet.</div>}
      {archived.length > 0 && (
        <div className="contact-inactive-section">
          <button type="button" className="contact-inactive-toggle" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "▾ Hide archived" : "▸ Show archived"} ({archived.length})
          </button>
          {showArchived && (
            <div className="contact-grid" style={{ marginTop: 12 }}>
              {archived.map(card)}
            </div>
          )}
        </div>
      )}
      {editing && (
        <AddressFormModal
          address={editing === "new" ? null : editing}
          ownerKind={ownerKind}
          ownerId={ownerId}
          firstOfKind={(kind) => !active.some((a) => a.kind === kind && a.id !== (editing === "new" ? null : editing.id))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddressFormModal({
  address,
  ownerKind,
  ownerId,
  firstOfKind,
  onClose,
  onSaved,
}: {
  address: Address | null;
  ownerKind: "customer" | "supplier";
  ownerId: string;
  firstOfKind: (kind: string) => boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const action = async (prev: FormState, form: FormData) => {
    const res = await saveAddressAction(ownerKind, ownerId, address?.id ?? null, prev, form);
    if (res.ok) onSaved();
    return res;
  };
  const { state, pending, onSubmit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const v = (k: keyof Address) => state.values?.[k] ?? (address?.[k] as string | null) ?? "";
  const defaultKind = ownerKind === "supplier" ? "OFFICE" : "BILLING";
  const [kind, setKind] = useState(v("kind") || defaultKind);
  const listId = `addr-${address?.id ?? "new"}`;

  return (
    <Modal title={address ? "Edit address" : "Add address"} onClose={onClose} labelId="address-form-title">
      <form onSubmit={onSubmit} noValidate>
        {state.message && !state.ok && (
          <div className="alert error" role="alert">
            {state.message}
          </div>
        )}
        <div className="form-grid">
          <Field label="Type" name="kind" required error={e.kind}>
            <select id="kind" name="kind" value={kind} onChange={(ev) => setKind(ev.target.value)}>
              {ADDRESS_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ADDRESS_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label" name="label" error={e.label} hint="Optional, e.g. Main office, Warehouse 2">
            <input id="label" name="label" type="text" defaultValue={v("label")} />
          </Field>
          <Field label="Unit / building / street" name="street" required error={e.street} full>
            <textarea id="street" name="street" rows={2} defaultValue={v("street")} placeholder="Unit 4B, Sample Tower, 12 Rizal St." />
          </Field>
          <Field label="Barangay" name="barangay" required error={e.barangay}>
            <input id="barangay" name="barangay" type="text" defaultValue={v("barangay")} placeholder="San Antonio" />
          </Field>
          <Field label="City / municipality" name="cityMunicipality" required error={e.cityMunicipality}>
            <input id="cityMunicipality" name="cityMunicipality" type="text" list={`${listId}-cities`} defaultValue={v("cityMunicipality")} autoComplete="off" />
          </Field>
          <Field label="Province" name="province" required error={e.province} hint="Metro Manila for NCR cities">
            <input id="province" name="province" type="text" list={`${listId}-provinces`} defaultValue={v("province")} autoComplete="off" />
          </Field>
          <Field label="ZIP code" name="zip" required error={e.zip}>
            <input id="zip" name="zip" type="text" inputMode="numeric" maxLength={4} pattern="\d{4}" defaultValue={v("zip")} placeholder="1605" />
          </Field>
          <div className="field full">
            <label className="check">
              <input
                type="checkbox"
                name="isDefault"
                defaultChecked={address ? address.isDefault : firstOfKind(kind)}
                // A default stays default until another address takes over ("Make default").
                disabled={!!address?.isDefault && address.kind === kind}
              />
              Default {ADDRESS_KIND_LABELS[kind as keyof typeof ADDRESS_KIND_LABELS]?.toLowerCase() ?? ""} address
            </label>
            <div className="hint">The first address of each type becomes its default automatically.</div>
          </div>
        </div>
        <datalist id={`${listId}-cities`}>
          {PH_CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id={`${listId}-provinces`}>
          {PH_PROVINCES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Saving…" : "Save address"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
