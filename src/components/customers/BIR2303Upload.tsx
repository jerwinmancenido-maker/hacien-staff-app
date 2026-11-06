// BIR 2303 upload on New Customer (step 1: read the text, show it).
// The file is staged on the server at upload time — the customer doesn't
// exist yet — and its storage key travels with the form so the save can
// attach it as the customer's BIR 2303 document. Reading never blocks
// the form: a failure shows an error and staff types manually.
"use client";

import { useState } from "react";
import { FileInput } from "@/components/FileInput";

type State =
  | { status: "idle" }
  | { status: "reading"; fileName: string }
  | { status: "done"; fileName: string; storageKey: string; text: string; source: "pdf" | "ocr" }
  | { status: "error"; message: string };

export function BIR2303Upload() {
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
    let body: { ok?: boolean; text?: string; source?: "pdf" | "ocr"; storageKey?: string; fileName?: string; message?: string };
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
    setState({
      status: "done",
      fileName: body.fileName ?? file.name,
      storageKey: body.storageKey ?? "",
      text: body.text ?? "",
      source: body.source ?? "pdf",
    });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>BIR 2303</h3>
      <p className="faint small" style={{ margin: "0 0 8px" }}>
        Upload the customer&apos;s BIR 2303 (PDF or photo) and the text is read out below. Check it against the form — nothing is filled in yet.
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
            <p className="small" style={{ margin: "0 0 4px" }}>
              What was read from {state.fileName} {state.source === "pdf" ? "(from the PDF)" : "(from the photo)"}:
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
