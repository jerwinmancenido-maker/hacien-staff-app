"use client";

import { useRef, useState } from "react";

/**
 * File picker that looks like the rest of the app. The browser's native
 * file input renders its own grey "Choose Files / No file chosen" chrome,
 * which matches nothing in the design system, so the real input is kept in
 * the DOM (visually hidden, still named — form submission and server-side
 * validation see exactly the same files as before) and a normal app button
 * opens the picker. The chosen file names show in app type, with a Clear
 * button to start over.
 */
export function FileInput({
  id,
  name,
  accept,
  multiple,
  required,
  buttonLabel = "Choose files",
  onFilesChange,
}: {
  id?: string;
  name: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  buttonLabel?: string;
  onFilesChange?: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  function update(next: File[]) {
    setFiles(next);
    onFilesChange?.(next);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    update([]);
  }

  return (
    <div className="file-input">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        required={required}
        className="file-input-hidden"
        onChange={(ev) => update(Array.from(ev.target.files ?? []))}
      />
      <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
        {buttonLabel}
      </button>
      <span className="faint small">
        {files.length > 0 ? files.map((f) => f.name).join(", ") : "No file chosen"}
      </span>
      {files.length > 0 ? (
        <button type="button" className="btn-link" onClick={clear}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
