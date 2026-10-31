"use client";

// Print & company details: plain labels, live letterhead preview, TIN/address warning.

import { useMemo, useRef, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FormState } from "@/lib/validation/forms";
import type { Settings } from "@/lib/settings/schema";
import { NON_VAT_LABEL } from "@/lib/print/tax-wording";
import { missingCompanyWarning } from "@/lib/print/company";

type Company = Settings["company"];
type Print = Settings["print"];

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

  const [live, setLive] = useState({
    name: company.name,
    tradeName: company.tradeName ?? "",
    tin: company.tin,
    address: company.address,
    phone: company.phone ?? "",
    email: company.email ?? "",
    website: company.website ?? "",
    paperSize: print.paperSize,
    showInputTaxDisclaimer: print.showInputTaxDisclaimer,
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

  return (
    <div className="card">
      <h2>Print &amp; company details</h2>
      <p className="muted small">
        These details appear on every printable document. Account numbers print as last 4 digits unless you turn on
        &quot;Print full account number&quot; for a receiving account.
      </p>
      {warning && (
        <div className="alert warn" role="status">
          <b>{warning}</b>
        </div>
      )}
      <form
        ref={formRef}
        noValidate
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
          if (t.name === "showInputTaxDisclaimer" && t instanceof HTMLInputElement) {
            setLive((prev) => ({ ...prev, showInputTaxDisclaimer: t.checked }));
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

        <div className="form-grid">
          <h3 className="section-title">Company letterhead</h3>
          <Field err={e.name} label="Registered business name" name="name" value={val("name", live.name)} />
          <Field err={e.tradeName} label="Trade name" name="tradeName" value={val("tradeName", live.tradeName)} hint="Optional. Shown under the registered name." />
          <Field err={e.tin} label="TIN (with branch code)" name="tin" value={val("tin", live.tin)} hint="000-000-000-000" />
          <div className={`field full${e.address ? " has-error" : ""}`}>
            <label htmlFor="address">Address</label>
            <textarea id="address" name="address" rows={3} defaultValue={val("address", live.address)} />
            {e.address && <div className="error" role="alert">{e.address}</div>}
          </div>
          <Field err={e.phone} label="Phone" name="phone" value={val("phone", live.phone)} />
          <Field err={e.email} label="Email" name="email" value={val("email", live.email)} />
          <Field err={e.website} label="Website" name="website" value={val("website", live.website)} />
          <div className="field full">
            <label htmlFor="logo">Company logo</label>
            <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
            <div className="hint">Optional. PNG/JPEG/WebP. Falls back to the business name when empty.</div>
          </div>

          <h3 className="section-title">Paper &amp; tax notes</h3>
          <div className="field">
            <label htmlFor="paperSize">Paper size</label>
            <select id="paperSize" name="paperSize" defaultValue={live.paperSize}>
              <option value="A4">A4 (default)</option>
              <option value="Letter">Letter</option>
            </select>
          </div>
          <div className="field full">
            <label className="check" htmlFor="showInputTaxDisclaimer">
              <input type="hidden" name="showInputTaxDisclaimer" value="false" />
              <input
                id="showInputTaxDisclaimer"
                name="showInputTaxDisclaimer"
                type="checkbox"
                value="true"
                defaultChecked={live.showInputTaxDisclaimer}
              />
              Print &quot;This document is not valid for claim of input tax&quot; on billing and collection documents
            </label>
            <div className="hint">Check with your accountant. HACIEN is NON-VAT — no VAT lines are ever printed.</div>
          </div>
          <div className="field full">
            <label className="check" htmlFor="showReceivingReportCosts">
              <input type="hidden" name="showReceivingReportCosts" value="false" />
              <input
                id="showReceivingReportCosts"
                name="showReceivingReportCosts"
                type="checkbox"
                value="true"
                defaultChecked={!!print.showReceivingReportCosts}
              />
              Show costs on receiving report prints (internal copies)
            </label>
            <div className="hint">OFF by default (qty only). Even when ON, only users with cost-view permission see unit costs.</div>
          </div>

          <h3 className="section-title">Quote / delivery notes</h3>
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

          <h3 className="section-title">Payment instructions (quotes, SOs, billings)</h3>
          <p className="muted small full">
            Last 4 digits are always stored. Turn on &quot;Print full account number&quot; only for accounts customers pay into.
          </p>
          {bankRows.map((row, i) => (
            <div key={`bank-${i}`} style={{ display: "contents" }}>
              <Field label={`Bank ${i + 1} name`} name={`banks.${i}.bankName`} value={row.bankName} err={e[`banks.${i}.bankName`]} />
              <Field label="Account name" name={`banks.${i}.accountName`} value={row.accountName} err={e[`banks.${i}.accountName`]} />
              <Field
                label="Account last 4 digits"
                name={`banks.${i}.accountLast4`}
                value={row.accountLast4}
                err={e[`banks.${i}.accountLast4`]}
                hint="Exactly 4 digits"
              />
              <div className="field full">
                <label className="check" htmlFor={`banks.${i}.printFullAccountNumber`}>
                  <input type="hidden" name={`banks.${i}.printFullAccountNumber`} value="false" />
                  <input
                    id={`banks.${i}.printFullAccountNumber`}
                    name={`banks.${i}.printFullAccountNumber`}
                    type="checkbox"
                    value="true"
                    defaultChecked={!!row.printFullAccountNumber}
                    onChange={(ev) =>
                      setBankRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, printFullAccountNumber: ev.target.checked } : r)))
                    }
                  />
                  Print full account number
                </label>
                <div className="hint">Only turn on for your own accounts that customers pay into.</div>
              </div>
              {row.printFullAccountNumber && (
                <Field
                  label="Full account number"
                  name={`banks.${i}.accountNumberFull`}
                  value={row.accountNumberFull ?? ""}
                  err={e[`banks.${i}.accountNumberFull`]}
                  hint="Stored only if you enter it. Digits, spaces or dashes."
                />
              )}
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
              <Field label={`E-wallet ${i + 1}`} name={`eWallets.${i}.provider`} value={row.provider} err={e[`eWallets.${i}.provider`]} />
              <Field label="Account name" name={`eWallets.${i}.accountName`} value={row.accountName} err={e[`eWallets.${i}.accountName`]} />
              <Field
                label="Account last 4 digits"
                name={`eWallets.${i}.accountLast4`}
                value={row.accountLast4}
                err={e[`eWallets.${i}.accountLast4`]}
              />
              <div className="field full">
                <label className="check" htmlFor={`eWallets.${i}.printFullAccountNumber`}>
                  <input type="hidden" name={`eWallets.${i}.printFullAccountNumber`} value="false" />
                  <input
                    id={`eWallets.${i}.printFullAccountNumber`}
                    name={`eWallets.${i}.printFullAccountNumber`}
                    type="checkbox"
                    value="true"
                    defaultChecked={!!row.printFullAccountNumber}
                    onChange={(ev) =>
                      setWalletRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, printFullAccountNumber: ev.target.checked } : r)))
                    }
                  />
                  Print full account number
                </label>
                <div className="hint">Only turn on for your own accounts that customers pay into.</div>
              </div>
              {row.printFullAccountNumber && (
                <Field
                  label="Full account number"
                  name={`eWallets.${i}.accountNumberFull`}
                  value={row.accountNumberFull ?? ""}
                  err={e[`eWallets.${i}.accountNumberFull`]}
                  hint="Stored only if you enter it. Digits, spaces or dashes."
                />
              )}
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

        <div className="print-preview-card" style={{ marginTop: 16 }} aria-live="polite">
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
            Paper: {live.paperSize} · Input-tax note: {live.showInputTaxDisclaimer ? "ON" : "OFF"}
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <span className="small faint">Changes apply to new documents; current letterhead also feeds PO/statement prints.</span>
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

function Field({
  label,
  name,
  value,
  err,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  err?: string;
  hint?: string;
}) {
  return (
    <div className={`field${err ? " has-error" : ""}`}>
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
