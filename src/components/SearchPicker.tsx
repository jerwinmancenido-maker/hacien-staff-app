"use client";

// SearchPicker — a record picker in the product picker's style (owner call
// 2026-11-09): type to filter in the field itself, matches drop down in a
// panel under it, and the create action is a "+ Add …" row PINNED at the
// bottom of the panel (below the scrolling list), never a button beside the
// field. A pinned row cannot scroll out of sight the way an option inside a
// native <select> popup did (the 2026-11-08 sweep's failure), because the
// list scrolls inside the panel and the add row sits outside that scroll
// area. Replaces native selects for Customer / Contact / Address / Supplier
// in the quote and PO editors.

import { useRef, useState, type KeyboardEvent } from "react";

export type SearchPickerOption = { id: string; label: string; meta?: string };

type Props = {
  id?: string;
  ariaLabel: string;
  /** Selected option id; "" means nothing picked. */
  value: string;
  options: SearchPickerOption[];
  /** Hint shown in the field when nothing is picked. */
  placeholder: string;
  /** Row at the top of the panel that picks "" (e.g. "None", "—"). */
  emptyOptionLabel?: string;
  disabled?: boolean;
  onPick: (id: string) => void;
  /** Pinned create row label without the "+ " prefix (e.g. "Add customer"). */
  addLabel?: string;
  onAdd?: () => void;
};

type Row = { id: string; label: string; meta?: string; isEmpty?: boolean };

export function SearchPicker({ id, ariaLabel, value, options, placeholder, emptyOptionLabel, disabled, onPick, addLabel, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const rows: Row[] = [
    ...(emptyOptionLabel && (!q || emptyOptionLabel.toLowerCase().includes(q)) ? [{ id: "", label: emptyOptionLabel, isEmpty: true }] : []),
    ...filtered,
  ];

  function openPanel() {
    if (disabled) return;
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    setQuery("");
  }

  function pick(row: Row) {
    onPick(row.id);
    closePanel();
    inputRef.current?.blur();
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (ev.key === "ArrowDown" || ev.key === "Enter") {
        ev.preventDefault();
        openPanel();
      }
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      closePanel();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (rows.length) setActive((a) => (a + 1) % rows.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (rows.length) setActive((a) => (a - 1 + rows.length) % rows.length);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const row = rows[active] ?? rows[0];
      if (row) pick(row);
    }
  }

  return (
    <div
      className="search-picker-wrap"
      onBlur={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) closePanel();
      }}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="input"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? "")}
        onFocus={openPanel}
        onChange={(ev) => {
          setQuery(ev.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="search-picker-caret" aria-hidden>
        ▾
      </span>
      {open && !disabled ? (
        <div className="quote-picker" role="listbox" aria-label={ariaLabel}>
          {rows.length === 0 ? (
            <div className="small muted">No match for “{query.trim()}”.</div>
          ) : (
            <ul className="plain-list search-picker-list">
              {rows.map((row, ix) => (
                <li key={row.isEmpty ? "__empty__" : row.id}>
                  <button
                    type="button"
                    className={`quote-picker-opt${ix === active ? " is-active" : ""}`}
                    role="option"
                    aria-selected={ix === active}
                    onMouseEnter={() => setActive(ix)}
                    onClick={() => pick(row)}
                  >
                    <span className={`quote-picker-name${row.isEmpty ? " search-picker-empty" : ""}`}>{row.label}</span>
                    {row.meta ? <span className="quote-picker-meta">{row.meta}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {onAdd && addLabel ? (
            <button
              type="button"
              className="quote-picker-add"
              onClick={() => {
                closePanel();
                onAdd();
              }}
            >
              + {addLabel}
            </button>
          ) : null}
          <button type="button" className="btn-link small" onClick={closePanel}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
