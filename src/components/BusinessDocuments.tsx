"use client";

// "Documents" tab on customer and supplier pages: business documents (DTI, SEC,
// BIR 2303, permits …) with expiry badges, download, replace and archive.
// Replacing = upload a new file + archive the old one (history stays).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BUSINESS_DOC_LABELS, BUSINESS_DOC_TYPES, type BusinessDocTypeValue } from "@/lib/business-docs/types";
import type { ExpiryStatus } from "@/lib/business-docs/expiry";
import { setBusinessDocumentArchivedAction, uploadBusinessDocumentAction } from "@/app/(app)/business-documents/actions";
import type { FormState } from "@/lib/validation/forms";
import { ConfirmDialog } from "./ConfirmDialog";
import { Field } from "./Field";
import { Chip, EmptyState, type ChipTone } from "./ui";
import { PlusIcon } from "./Icons";
import { useFormAction } from "./useFormAction";

export type BusinessDocRow = {
  id: string;
  type: BusinessDocTypeValue;
  typeLabel: string;
  docNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  expiry: ExpiryStatus & { label: string };
  fileName: string;
  sizeLabel: string;
  uploadedBy: string;
  uploadedAt: string;
  archived: boolean;
};

const TONE: Record<ExpiryStatus["state"], ChipTone> = { none: "grey", valid: "green", expiring: "amber", expired: "red" };

export function BusinessDocuments({
  docs,
  ownerKind,
  ownerId,
  canEdit,
  maxMb,
  showArchived,
  archivedHref,
  archivedCount,
}: {
  docs: BusinessDocRow[];
  ownerKind: "customer" | "supplier";
  ownerId: string;
  canEdit: boolean;
  maxMb: number;
  showArchived: boolean;
  archivedHref: string;
  archivedCount: number;
}) {
  const router = useRouter();
  const [upload, setUpload] = useState<{ replaces?: BusinessDocRow } | null>(null);
  const [archiving, setArchiving] = useState<BusinessDocRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<FormState>) =>
    startTransition(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.message ?? "Something went wrong."));
      router.refresh();
    });

  return (
    <div className="card">
      <div className="card-head">
        <h2>Business documents</h2>
        <div className="right">
          {archivedCount > 0 && (
            <Link className={`filter-chip${showArchived ? " active" : ""}`} href={archivedHref} aria-pressed={showArchived}>
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Link>
          )}
          {canEdit && !upload && (
            <button type="button" className="btn btn-sm" onClick={() => setUpload({})}>
              <PlusIcon size={13} /> Upload document
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {upload && (
        <UploadForm
          key={upload.replaces?.id ?? "new"}
          ownerKind={ownerKind}
          ownerId={ownerId}
          maxMb={maxMb}
          replaces={upload.replaces}
          onDone={() => {
            setUpload(null);
            router.refresh();
          }}
          onCancel={() => setUpload(null)}
        />
      )}
      {docs.length === 0 ? (
        <EmptyState title="No documents yet" line="Upload DTI / SEC registration, BIR 2303, permits and clearances here." />
      ) : (
        <div className="table-wrap">
          <table className="list" aria-label="Business documents">
            <thead>
              <tr>
                <th>Type</th>
                <th>Number</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className={d.archived ? "inactive" : undefined}>
                  <td>
                    <div className="strong">{d.typeLabel}</div>
                    <div className="small faint" title={d.fileName}>
                      {d.fileName} · {d.sizeLabel}
                    </div>
                  </td>
                  <td>{d.docNumber ?? <span className="faint">—</span>}</td>
                  <td>{d.issueDate ?? <span className="faint">—</span>}</td>
                  <td>{d.expiryDate ?? <span className="faint">—</span>}</td>
                  <td>
                    {d.archived ? <Chip tone="grey">Archived</Chip> : <Chip tone={TONE[d.expiry.state]}>{d.expiry.label}</Chip>}
                  </td>
                  <td>
                    <div>{d.uploadedBy}</div>
                    <div className="small faint">{d.uploadedAt}</div>
                  </td>
                  <td>
                    <div className="doc-actions">
                      <a className="btn btn-secondary btn-sm" href={`/files/business-documents/${d.id}`} download>
                        Download
                      </a>
                      {canEdit && !d.archived && (
                        <>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUpload({ replaces: d })}>
                            Replace
                          </button>
                          <button type="button" className="btn btn-danger btn-sm" disabled={isPending} onClick={() => setArchiving(d)}>
                            Archive
                          </button>
                        </>
                      )}
                      {canEdit && d.archived && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={isPending} onClick={() => run(() => setBusinessDocumentArchivedAction(d.id, false))}>
                          Restore
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={!!archiving}
        title="Archive this document?"
        body="It's hidden from the list but kept, and can still be downloaded from the archived view."
        confirmLabel="Archive"
        danger
        onCancel={() => setArchiving(null)}
        onConfirm={() => {
          const d = archiving;
          setArchiving(null);
          if (d) run(() => setBusinessDocumentArchivedAction(d.id, true));
        }}
      />
    </div>
  );
}

function UploadForm({
  ownerKind,
  ownerId,
  maxMb,
  replaces,
  onDone,
  onCancel,
}: {
  ownerKind: "customer" | "supplier";
  ownerId: string;
  maxMb: number;
  replaces?: BusinessDocRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const action = async (prev: FormState, form: FormData) => {
    const res = await uploadBusinessDocumentAction(ownerKind, ownerId, prev, form);
    if (res.ok) onDone();
    return res;
  };
  const { state, pending, onSubmit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const [type, setType] = useState<string>(state.values?.type ?? replaces?.type ?? "");
  const [fileError, setFileError] = useState<string | null>(null);

  return (
    <form onSubmit={onSubmit} noValidate className="upload-form" encType="multipart/form-data">
      <h3>{replaces ? `Replace ${replaces.typeLabel}` : "Upload a document"}</h3>
      {replaces && <p className="small muted">The new file is added and {replaces.fileName} is archived (kept in history).</p>}
      {state.message && !state.ok && (
        <div className="alert error" role="alert">
          {state.message}
        </div>
      )}
      {replaces && <input type="hidden" name="replacesId" value={replaces.id} />}
      <div className="form-grid">
        <Field label="Type" name="type" required error={e.type}>
          <select id="type" name="type" value={type} onChange={(ev) => setType(ev.target.value)}>
            <option value="">Pick one…</option>
            {BUSINESS_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {BUSINESS_DOC_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        {type === "OTHER" && (
          <Field label="What document is it?" name="otherLabel" required error={e.otherLabel}>
            <input id="otherLabel" name="otherLabel" type="text" defaultValue={state.values?.otherLabel ?? ""} />
          </Field>
        )}
        <Field label="Document number" name="docNumber" error={e.docNumber}>
          <input id="docNumber" name="docNumber" type="text" defaultValue={state.values?.docNumber ?? replaces?.docNumber ?? ""} />
        </Field>
        <Field label="Issue date" name="issueDate" error={e.issueDate}>
          <input id="issueDate" name="issueDate" type="date" className="input" defaultValue={state.values?.issueDate ?? ""} />
        </Field>
        <Field label="Expiry date" name="expiryDate" error={e.expiryDate} hint="Leave empty if it doesn't expire.">
          <input id="expiryDate" name="expiryDate" type="date" className="input" defaultValue={state.values?.expiryDate ?? ""} />
        </Field>
        <Field label="File" name="file" required error={e.file ?? fileError ?? undefined} hint={`PDF, JPG or PNG, up to ${maxMb} MB.`} full>
          <input
            id="file"
            name="file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              setFileError(f && f.size > maxMb * 1024 * 1024 ? `The file is too big. The limit is ${maxMb} MB.` : null);
            }}
          />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending || !!fileError}>
          {pending ? "Uploading…" : replaces ? "Upload replacement" : "Upload"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
