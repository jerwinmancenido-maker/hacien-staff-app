"use client";

// Phase 4 #4: CSV import form — upload → preview → confirm.
// The preview is stacked rows on phone widths and a grid on desktop
// (see .import-rows in globals.css), never a wide table. Confirm stays
// disabled while any kept row has an error (scenario I2): fix the file
// or remove the error row here, then confirm. Removed rows are sent to
// the server as excluded spreadsheet lines; the server re-validates
// everything it creates, so this state is a convenience, not a check.

import { useActionState, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui";
import { FileInput } from "@/components/FileInput";
import type { ImportRowPreview } from "@/lib/items/import";
import type { ItemsImportActionState } from "@/lib/items/import-shared";

type Action = (state: ItemsImportActionState, form: FormData) => Promise<ItemsImportActionState>;
type Dispatch = (form: FormData) => void;

const INITIAL: ItemsImportActionState = { stage: "upload" };

export function ItemsImportForm({ action }: { action: Action }) {
  // "Start over" remounts the inner form, which resets the action state.
  const [epoch, setEpoch] = useState(0);
  return <ImportFormInner key={epoch} action={action} onReset={() => setEpoch((e) => e + 1)} />;
}

function ImportFormInner({ action, onReset }: { action: Action; onReset: () => void }) {
  const [state, dispatch, pending] = useActionState(action, INITIAL);

  if (state.stage === "done") {
    return (
      <div className="card">
        {state.message && (
          <div className="alert ok" role="status">
            {state.message}
          </div>
        )}
        <p className="small faint">Batch ID: {state.batchId}</p>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" href="/items">
            Back to items
          </Link>
        </p>
      </div>
    );
  }

  if (state.stage === "preview" && !state.fileError) {
    return <PreviewPanel key={state.nonce ?? "preview"} state={state} dispatch={dispatch} pending={pending} onReset={onReset} />;
  }

  return (
    <div className="card">
      {state.message && (
        <div className="alert error" role="alert">
          {state.message}
        </div>
      )}
      {state.fileError && (
        <div className="alert error" role="alert">
          {state.fileError}
        </div>
      )}
      <p className="small">
        Upload a .csv with a header row. Columns (any order): <strong>name</strong> and <strong>unit</strong> are required; brand, model,
        category, sku, kind, details and defaultUnitPrice are optional. Up to 1,000 rows. Nothing is saved until you confirm the preview.
      </p>
      <form action={dispatch} style={{ marginTop: 12 }}>
        <input type="hidden" name="intent" value="preview" />
        <FileInput name="file" accept=".csv,text/csv" buttonLabel="Choose .csv file" />
        <p style={{ marginTop: 12 }}>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Checking…" : "Preview import"}
          </button>
        </p>
      </form>
    </div>
  );
}

function PreviewPanel({ state, dispatch, pending, onReset }: { state: ItemsImportActionState; dispatch: Dispatch; pending: boolean; onReset: () => void }) {
  const rows = state.rows ?? [];
  const [removed, setRemoved] = useState<number[]>([]);
  const kept = rows.filter((r) => !removed.includes(r.line));
  const errorRows = kept.filter((r) => r.errors.length > 0);
  const canConfirm = kept.length > 0 && errorRows.length === 0;
  const excluded = [...(state.excludedLines ?? []), ...removed];

  return (
    <div className="card">
      {state.message && (
        <div className="alert error" role="alert">
          {state.message}
        </div>
      )}
      <p className="small">
        {state.fileName ? (
          <>
            <strong>{state.fileName}</strong> —{" "}
          </>
        ) : null}
        {kept.length} row{kept.length === 1 ? "" : "s"} to import
        {errorRows.length > 0 ? (
          <>
            {" · "}
            <strong>{errorRows.length} with errors</strong> — fix the file and re-upload, or remove those rows below.
          </>
        ) : (
          <> · all rows pass the item checks.</>
        )}
      </p>

      <div className="import-rows">
        <div className="import-row import-row-head" aria-hidden="true">
          <span>Line</span>
          <span>Item</span>
          <span>SKU</span>
          <span>Unit</span>
          <span>Default price</span>
          <span>Status</span>
          <span />
        </div>
        {rows.map((row) => (
          <PreviewRow key={row.line} row={row} removed={removed.includes(row.line)} onRemove={() => setRemoved((r) => [...r, row.line])} onUndo={() => setRemoved((r) => r.filter((l) => l !== row.line))} />
        ))}
      </div>

      <form action={dispatch} style={{ marginTop: 12 }}>
        <input type="hidden" name="intent" value="confirm" />
        <input type="hidden" name="csvText" value={state.csvText ?? ""} />
        <input type="hidden" name="excludedLines" value={excluded.join(",")} />
        <button className="btn" type="submit" disabled={!canConfirm || pending}>
          {pending ? "Importing…" : `Confirm import (${kept.length})`}
        </button>{" "}
        <button className="btn secondary" type="button" onClick={onReset}>
          Start over
        </button>
      </form>
    </div>
  );
}

function PreviewRow({ row, removed, onRemove, onUndo }: { row: ImportRowPreview; removed: boolean; onRemove: () => void; onUndo: () => void }) {
  const v = row.values;
  const brandModel = [v.brand, v.model].filter(Boolean).join(" · ");
  return (
    <div className={`import-row${removed ? " import-row-removed" : ""}`}>
      <span className="import-cell">
        <span className="import-cell-label">Line</span>
        {row.line}
      </span>
      <span className="import-cell">
        <span className="import-cell-label">Item</span>
        {v.name || "—"}
        {brandModel ? <span className="small faint"> · {brandModel}</span> : null}
      </span>
      <span className="import-cell">
        <span className="import-cell-label">SKU</span>
        {v.sku || "—"}
      </span>
      <span className="import-cell">
        <span className="import-cell-label">Unit</span>
        {v.unit || "—"}
      </span>
      <span className="import-cell">
        <span className="import-cell-label">Default price</span>
        {v.defaultunitprice || "—"}
      </span>
      <span className="import-cell">
        <span className="import-cell-label">Status</span>
        {removed ? (
          <Chip tone="grey">Removed</Chip>
        ) : row.errors.length > 0 ? (
          <>
            <Chip tone="red">Error</Chip>
            <span className="small" style={{ display: "block", color: "var(--red)" }}>
              {row.errors.join(" ")}
            </span>
          </>
        ) : (
          <Chip tone="green">OK</Chip>
        )}
      </span>
      <span className="import-cell">
        {removed ? (
          <button type="button" className="btn-link" onClick={onUndo}>
            Undo remove
          </button>
        ) : row.errors.length > 0 ? (
          <button type="button" className="btn-link" onClick={onRemove}>
            Remove row
          </button>
        ) : null}
      </span>
    </div>
  );
}
