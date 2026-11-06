// BIR 2303 upload on New Customer (step 2: read the text, structure it
// with Claude when the key is set, and pre-fill the form). The file is
// staged on the server at upload time — the customer doesn't exist yet —
// and its storage key travels with the form so the save can attach it as
// the customer's BIR 2303 document. Reading never blocks the form: a
// failure shows an error and staff types manually. Only high/medium
// confidence fields are filled in, and only into fields staff left
// empty — low-confidence fields stay blank.
"use client";

import { useState } from "react";
import { FileInput } from "@/components/FileInput";
import type { Structured2303, StructureUsage } from "@/lib/2303/claude";
import { buildPrefill } from "@/lib/2303/prefill";
import type { Filled, Prefill } from "@/lib/2303/prefill";

type AiStatus = { available: boolean; error?: string };

type State =
  | { status: "idle" }
  | { status: "reading"; fileName: string }
  | {
      status: "done";
      fileName: string;
      storageKey: string;
      text: string;
      source: "pdf" | "ocr" | "pdf-ocr";
      ai: AiStatus;
      fields?: Structured2303;
      usage?: StructureUsage;
      filled: Filled[];
      leftBlank: string[];
    }
  | { status: "error"; message: string };

type ParseBody = {
  ok?: boolean;
  text?: string;
  source?: "pdf" | "ocr" | "pdf-ocr";
  storageKey?: string;
  fileName?: string;
  message?: string;
  ai?: AiStatus;
  fields?: Structured2303;
  usage?: StructureUsage;
};

const CONFIDENCE_LABEL = { high: "high confidence", medium: "medium confidence" } as const;

const SOURCE_LABEL = {
  pdf: "(from the PDF)",
  ocr: "(from the photo)",
  "pdf-ocr": "(from the scanned PDF)",
} as const;

export function BIR2303Upload({ onPrefill }: { onPrefill?: (prefill: Prefill) => void }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function onFilesChange(files: File[]) {
    const file = files[0];
    if (!file) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "reading", fileName: file.name });
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch("/api/customers/parse-2303", { method: "POST", body: form });
    } catch {
      setState({ status: "error", message: "Could not reach the server. Try again, or type the details manually." });
      return;
    }
    let body: ParseBody;
    try {
      body = await res.json();
    } catch {
      setState({ status: "error", message: "The server gave an unreadable answer. Try again, or type the details manually." });
      return;
    }
    if (!body.ok) {
      setState({ status: "error", message: body.message ?? "Could not read this file." });
      return;
    }
    const fields = body.fields;
    let filled: Filled[] = [];
    let leftBlank: string[] = [];
    if (fields) {
      const mapped = buildPrefill(fields);
      filled = mapped.filled;
      leftBlank = mapped.leftBlank;
      if (Object.keys(mapped.prefill).length > 0) onPrefill?.(mapped.prefill);
    }
    setState({
      status: "done",
      fileName: body.fileName ?? file.name,
      storageKey: body.storageKey ?? "",
      text: body.text ?? "",
      source: body.source ?? "pdf",
      ai: body.ai ?? { available: false },
      fields,
      usage: body.usage,
      filled,
      leftBlank,
    });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>BIR 2303</h3>
      <p className="faint small" style={{ margin: "0 0 8px" }}>
        Upload the customer&apos;s BIR 2303 (PDF or photo). The details are read out and filled into the form below — check them before saving.
      </p>
      {/* The picker uploads immediately via fetch; its input must NOT be
          part of the customer form (an empty name is never submitted), or
          the file would be sent again with every save. The staged file
          travels via the hidden inputs below. */}
      <FileInput name="" accept=".pdf,.jpg,.jpeg,.png" buttonLabel="Choose BIR 2303" onFilesChange={onFilesChange} />
      {state.status === "reading" && (
        <p className="faint small" role="status">
          Reading {state.fileName}…
        </p>
      )}
      {state.status === "error" && (
        <div className="alert error" role="status" style={{ marginTop: 8 }}>
          {state.message}
        </div>
      )}
      {state.status === "done" && (
        <>
          <input type="hidden" name="bir2303StorageKey" value={state.storageKey} />
          <input type="hidden" name="bir2303FileName" value={state.fileName} />
          <div style={{ marginTop: 8 }}>
            {!state.ai.available && (
              <p className="small" style={{ margin: "0 0 8px" }}>
                Auto-fill isn&apos;t set up on this site, so nothing was filled in — type the details from the text below.
              </p>
            )}
            {state.ai.available && state.ai.error && (
              <div className="alert error" role="status" style={{ marginTop: 8, marginBottom: 8 }}>
                {state.ai.error}
              </div>
            )}
            {state.ai.available && !state.ai.error && state.fields && (
              <>
                {state.filled.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <p className="small" style={{ margin: "0 0 4px" }}>
                      Filled in from the 2303 — check before saving:
                    </p>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {state.filled.map((f) => (
                        <li key={f.label}>
                          {f.label}: {f.value} <span className="faint">({CONFIDENCE_LABEL[f.confidence]})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {state.leftBlank.length > 0 && (
                  <p className="small faint" style={{ margin: "0 0 8px" }}>
                    Left blank: {state.leftBlank.join("; ")}.
                  </p>
                )}
                {(state.fields.rdo.value || state.fields.dateRegistered.value) && (
                  <p className="small faint" style={{ margin: "0 0 8px" }}>
                    {state.fields.rdo.value ? `RDO ${state.fields.rdo.value}` : ""}
                    {state.fields.rdo.value && state.fields.dateRegistered.value ? " · " : ""}
                    {state.fields.dateRegistered.value ? `Registered ${state.fields.dateRegistered.value}` : ""} — shown
                    here, not saved on the customer.
                  </p>
                )}
                {state.usage && (
                  <p className="small faint" style={{ margin: "0 0 8px" }}>
                    Auto-fill used {state.usage.inputTokens.toLocaleString()} in / {state.usage.outputTokens.toLocaleString()} out
                    tokens (about ${((state.usage.inputTokens / 1e6) * 1 + (state.usage.outputTokens / 1e6) * 5).toFixed(4)}).
                  </p>
                )}
              </>
            )}
            <p className="small" style={{ margin: "0 0 4px" }}>
              What was read from {state.fileName} {SOURCE_LABEL[state.source]}:
            </p>
            <pre className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto", background: "#f6f6f6", padding: 12, borderRadius: 8, margin: 0 }}>
              {state.text}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
