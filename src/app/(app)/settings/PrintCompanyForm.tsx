"use client";

// Print & company details: collapsible sections, sticky live preview, TIN/address warning.
// Collapsed sections stay mounted (hidden) so every field still submits.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FormState } from "@/lib/validation/forms";
import type { Settings } from "@/lib/settings/schema";
import { NON_VAT_LABEL } from "@/lib/print/tax-wording";
import { missingCompanyWarning } from "@/lib/print/company";

type Company = Settings["company"];
type Print = Settings["print"];

type SectionId = "letterhead" | "paper" | "notes" | "payment";

export function PrintCompanyForm({
  company,
  print,
  versionId,
  action,
}: {
  company: Company;
  print: Print;
  versionId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const { state, pending, submit } = useFormAction(action);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    letterhead: true,
    paper: false,
    notes: false,
    payment: false,
  });

  const [live, setLive] = useState({
    name: company.name,
    tradeName: company.tradeName ?? "",
    tin: company.tin,
    address: company.address,
    phone: company.phone ?? "",
    email: company.email ?? "",
    website: company.website ?? "",
    paperSize: print.paperSize,
    showTermsQr: print.showTermsQr,
    banks: print.banks,
    eWallets: print.eWallets,
  });

  const emptyBank = {
    bankName: "",
    accountName: "",
    accountLast4: "",
    printFullAccountNumber: false,
    accountNumberFull: "",
  };
  const emptyWallet = {
    provider: "",
    accountName: "",
    accountLast4: "",
    printFullAccountNumber: false,
    accountNumberFull: "",
  };
  const [bankRows, setBankRows] = useState(
    print.banks.length
      ? print.banks.map((b) => ({
          ...b,
          printFullAccountNumber: b.printFullAccountNumber ?? false,
          accountNumberFull: b.accountNumberFull ?? "",
        }))
      : [emptyBank],
  );
  const [walletRows, setWalletRows] = useState(
    print.eWallets.length
      ? print.eWallets.map((w) => ({
          ...w,
          printFullAccountNumber: w.printFullAccountNumber ?? false,
          accountNumberFull: w.accountNumberFull ?? "",
        }))
      : [emptyWallet],
  );

  const warning = useMemo(
    () => missingCompanyWarning({ ...company, name: live.name, tin: live.tin, address: live.address }),
    [company, live.name, live.tin, live.address],
  );

  const val = (name: string, fallback: string) => state.values?.[name] ?? fallback;

  const toggle = (id: SectionId) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="card settings-section print-company-card">
      <h2 className="settings-section-title">Print &amp; company details</h2>
      <p className="muted small">
        These details appear on every printable document. Account numbers print as last 4 digits unless you turn on
        &quot;Print full account number&quot; for a receiving account.
      </p>
      {warning && (
        <div className="settings-notice" role="status">
          <b>{warning}</b>
        </div>
      )}
      <form
        ref={formRef}
        noValidate
        className="print-company-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          setConfirming(true);
        }}
        onInput={(ev) => {
          const t = ev.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          if (!t.name) return;
          if (t.name === "name" || t.name === "tradeName" || t.name === "tin" || t.name === "address" || t.name === "phone" || t.name === "email" || t.name === "website") {
            setLive((prev) => ({ ...prev, [t.name]: t.value }));
          }
          if (t.name === "paperSize") setLive((prev) => ({ ...prev, paperSize: t.value as "A4" | "Letter" }));
          if (t.name === "showTermsQr" && t instanceof HTMLInputElement) {
            setLive((prev) => ({ ...prev, showTermsQr: t.checked }));
          }
        }}
      >
        {state.message && (
          <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
            {state.message}
          </div>
        )}
        <input type="hidden" name="baseVersionId" value={versionId} />
        <input type="hidden" name="logoStorageKey" value={company.logoStorageKey ?? ""} />
        <input type="hidden" name="bankCount" value={String(bankRows.length)} />
        <input type="hidden" name="eWalletCount" value={String(walletRows.length)} />

        <div className="print-company-layout">
          <div className="print-company-fields">
            <CollapsibleSection
              id="letterhead"
              title="Company letterhead"
              open={open.letterhead}
              onToggle={() => toggle("letterhead")}
            >
              <div className="form-grid">
                <Field err={e.name} label="Registered business name" name="name" value={val("name", live.name)} full />
                <Field
                  err={e.tradeName}
                  label="Trade name"
                  name="tradeName"
                  value={val("tradeName", live.tradeName)}
                  hint="Optional. Shown under the registered name."
                />
                <Field err={e.tin} label="TIN (with branch code)" name="tin" value={val("tin", live.tin)} hint="000-000-000-000" />
                <div className={`field full${e.address ? " has-error" : ""}`}>
                  <label htmlFor="address">Address</label>
                  <textarea id="address" name="address" rows={3} defaultValue={val("address", live.address)} />
                  {e.address && (
                    <div className="error" role="alert">
                      {e.address}
                    </div>
                  )}
                </div>
                <Field err={e.phone} label="Phone" name="phone" value={val("phone", live.phone)} full />
                <Field err={e.email} label="Email" name="email" value={val("email", live.email)} />
                <Field err={e.website} label="Website" name="website" value={val("website", live.website)} />
                <div className="field full">
                  <label htmlFor="logo">Company logo</label>
                  <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
                  <div className="hint">Optional. PNG/JPEG/WebP. Falls back to the business name when empty.</div>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="paper"
              title="Paper &amp; tax notes"
              open={open.paper}
              onToggle={() => toggle("paper")}
            >
              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="paperSize">Paper size</label>
                  <select id="paperSize" name="paperSize" defaultValue={live.paperSize}>
                    <option value="A4">A4 (default)</option>
                    <option value="Letter">Letter</option>
                  </select>
                </div>
                <input
                  type="hidden"
                  name="showInputTaxDisclaimer"
                  value={print.showInputTaxDisclaimer ? "true" : "false"}
                />
                <p className="hint">
                  Billing, collection, quote, sales order, and customer statement prints always include: THIS DOCUMENT
                  IS NOT VALID FOR CLAIM OF INPUT TAX.
                </p>
                <div className="field full field-check">
                  <label className="check" htmlFor="showTermsQr">
                    <input type="hidden" name="showTermsQr" value="false" />
                    <input
                      id="showTermsQr"
                      name="showTermsQr"
                      type="checkbox"
                      value="true"
                      defaultChecked={print.showTermsQr}
                    />
                    <span className="check-label-text">Show terms QR on prints</span>
                  </label>
                  <div className="hint">
                    Off by default. When on, prints show a QR code and a link to https://haciensolutions.com/policies.
                  </div>
                </div>
                <div className="field full field-check">
                  <label className="check" htmlFor="showReceivingReportCosts">
                    <input type="hidden" name="showReceivingReportCosts" value="false" />
                    <input
                      id="showReceivingReportCosts"
                      name="showReceivingReportCosts"
                      type="checkbox"
                      value="true"
                      defaultChecked={!!print.showReceivingReportCosts}
                    />
                    <span className="check-label-text">Show costs on receiving report prints (internal copies)</span>
                  </label>
                  <div className="hint">OFF by default (qty only). Even when ON, only users with cost-view permission see unit costs.</div>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="notes"
              title="Quote / delivery notes"
              open={open.notes}
              onToggle={() => toggle("notes")}
            >
              <div className="form-grid">
                <div className={`field full${e.quoteTerms ? " has-error" : ""}`}>
                  <label htmlFor="quoteTerms">Default quote terms &amp; conditions</label>
                  <textarea id="quoteTerms" name="quoteTerms" rows={3} defaultValue={print.quoteTerms ?? ""} />
                </div>
                <div className="field full">
                  <label htmlFor="deliveryNotes">Delivery notes</label>
                  <textarea id="deliveryNotes" name="deliveryNotes" rows={2} defaultValue={print.deliveryNotes ?? ""} />
                </div>
                <div className="field full">
                  <label htmlFor="warrantyNotes">Warranty notes</label>
                  <textarea id="warrantyNotes" name="warrantyNotes" rows={2} defaultValue={print.warrantyNotes ?? ""} />
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="payment"
              title="Payment instructions"
              open={open.payment}
              onToggle={() => toggle("payment")}
            >
              <div className="form-grid">
                <p className="muted small full">
                  Last 4 digits are always stored. Turn on &quot;Print full account number&quot; only for accounts
                  customers pay into.
                </p>
                {bankRows.map((row, i) => (
                  <div key={`bank-${i}`} style={{ display: "contents" }}>
                    <Field
                      label={`Bank ${i + 1} name`}
                      name={`banks.${i}.bankName`}
                      value={row.bankName}
                      err={e[`banks.${i}.bankName`]}
                    />
                    <Field
                      label="Account name"
                      name={`banks.${i}.accountName`}
                      value={row.accountName}
                      err={e[`banks.${i}.accountName`]}
                    />
                    <Field
                      label="Account last 4 digits"
                      name={`banks.${i}.accountLast4`}
                      value={row.accountLast4}
                      err={e[`banks.${i}.accountLast4`]}
                      hint="Exactly 4 digits"
                    />
                    <div className="field field-check">
                      <label className="check" htmlFor={`banks.${i}.printFullAccountNumber`}>
                        <input type="hidden" name={`banks.${i}.printFullAccountNumber`} value="false" />
                        <input
                          id={`banks.${i}.printFullAccountNumber`}
                          name={`banks.${i}.printFullAccountNumber`}
                          type="checkbox"
                          value="true"
                          defaultChecked={!!row.printFullAccountNumber}
                          onChange={(ev) =>
                            setBankRows((rows) =>
                              rows.map((r, idx) => (idx === i ? { ...r, printFullAccountNumber: ev.target.checked } : r)),
                            )
                          }
                        />
                        Print full account number
                      </label>
                      <div className="hint">Only turn on for your own accounts that customers pay into.</div>
                    </div>
                    {/* Keep full-account field mounted so a save never drops the value when collapsed/unchecked UI hides it. */}
                    <div
                      className={`field${row.printFullAccountNumber ? "" : " print-field-visually-hidden"}`}
                      data-keep-mounted="1"
                    >
                      <label htmlFor={`banks.${i}.accountNumberFull`}>Full account number</label>
                      <input
                        id={`banks.${i}.accountNumberFull`}
                        name={`banks.${i}.accountNumberFull`}
                        type="text"
                        defaultValue={row.accountNumberFull ?? ""}
                      />
                      {e[`banks.${i}.accountNumberFull`] ? (
                        <div className="error" role="alert">
                          {e[`banks.${i}.accountNumberFull`]}
                        </div>
                      ) : (
                        <div className="hint">Stored only if you enter it. Digits, spaces or dashes.</div>
                      )}
                    </div>
                  </div>
                ))}
                <div className="field full">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={bankRows.length >= 5}
                    onClick={() => setBankRows((r) => [...r, { ...emptyBank }])}
                  >
                    Add bank
                  </button>
                </div>
                {walletRows.map((row, i) => (
                  <div key={`wallet-${i}`} style={{ display: "contents" }}>
                    <Field
                      label={`E-wallet ${i + 1}`}
                      name={`eWallets.${i}.provider`}
                      value={row.provider}
                      err={e[`eWallets.${i}.provider`]}
                    />
                    <Field
                      label="Account name"
                      name={`eWallets.${i}.accountName`}
                      value={row.accountName}
                      err={e[`eWallets.${i}.accountName`]}
                    />
                    <Field
                      label="Account last 4 digits"
                      name={`eWallets.${i}.accountLast4`}
                      value={row.accountLast4}
                      err={e[`eWallets.${i}.accountLast4`]}
                    />
                    <div className="field field-check">
                      <label className="check" htmlFor={`eWallets.${i}.printFullAccountNumber`}>
                        <input type="hidden" name={`eWallets.${i}.printFullAccountNumber`} value="false" />
                        <input
                          id={`eWallets.${i}.printFullAccountNumber`}
                          name={`eWallets.${i}.printFullAccountNumber`}
                          type="checkbox"
                          value="true"
                          defaultChecked={!!row.printFullAccountNumber}
                          onChange={(ev) =>
                            setWalletRows((rows) =>
                              rows.map((r, idx) => (idx === i ? { ...r, printFullAccountNumber: ev.target.checked } : r)),
                            )
                          }
                        />
                        Print full account number
                      </label>
                      <div className="hint">Only turn on for your own accounts that customers pay into.</div>
                    </div>
                    <div
                      className={`field${row.printFullAccountNumber ? "" : " print-field-visually-hidden"}`}
                      data-keep-mounted="1"
                    >
                      <label htmlFor={`eWallets.${i}.accountNumberFull`}>Full account number</label>
                      <input
                        id={`eWallets.${i}.accountNumberFull`}
                        name={`eWallets.${i}.accountNumberFull`}
                        type="text"
                        defaultValue={row.accountNumberFull ?? ""}
                      />
                      {e[`eWallets.${i}.accountNumberFull`] ? (
                        <div className="error" role="alert">
                          {e[`eWallets.${i}.accountNumberFull`]}
                        </div>
                      ) : (
                        <div className="hint">Stored only if you enter it. Digits, spaces or dashes.</div>
                      )}
                    </div>
                  </div>
                ))}
                <div className="field full">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={walletRows.length >= 5}
                    onClick={() => setWalletRows((r) => [...r, { ...emptyWallet }])}
                  >
                    Add e-wallet
                  </button>
                </div>
              </div>
            </CollapsibleSection>
          </div>

          <aside className="print-preview-card print-company-preview" aria-live="polite">
            <div className="pp-label">Live preview</div>
            <div className="pp-trade-name" style={{ fontSize: "1.15rem" }}>
              {(live.tradeName ?? "").trim() || live.name || "—"}
            </div>
            <div className="pp-pre">{live.address || "[address not set]"}</div>
            <div className="pp-tin-row">
              <span>TIN {live.tin || "[not set]"}</span>
              <span className="pp-nonvat">{NON_VAT_LABEL}</span>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {[live.email, live.phone].filter(Boolean).join(" · ") || "No email / phone yet"}
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              Paper: {live.paperSize} · Terms QR: {live.showTermsQr ? "On" : "Off"}
            </div>
          </aside>
        </div>

        <div className="form-actions settings-form-actions">
          <span className="small faint settings-form-footnote">
            Changes apply to new documents; current letterhead also feeds PO/statement prints.
          </span>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title="Change print & company details?"
        body="This saves a new settings version. Documents already made keep older company snapshots where they were pinned."
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

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `print-section-${id}`;
  const btnId = `print-section-${id}-btn`;
  return (
    <div className={`print-collapse${open ? " is-open" : ""}`} data-section={id}>
      <h3 className="print-collapse-head">
        <button
          type="button"
          id={btnId}
          className="print-collapse-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className={`print-collapse-chevron${open ? " is-open" : ""}`} aria-hidden />
          <span>{title}</span>
        </button>
      </h3>
      {/* Hidden-not-unmounted: collapsed panels stay in the DOM so fields still submit. */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={btnId}
        className={`print-collapse-body${open ? "" : " is-collapsed"}`}
        data-collapsed={open ? "0" : "1"}
        inert={open ? undefined : true}
      >
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  err,
  hint,
  full,
}: {
  label: string;
  name: string;
  value: string;
  err?: string;
  hint?: string;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? " full" : ""}${err ? " has-error" : ""}`}>
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} type="text" defaultValue={value} />
      {err ? (
        <div className="error" role="alert">
          {err}
        </div>
      ) : (
        hint && <div className="hint">{hint}</div>
      )}
    </div>
  );
}
