"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon } from "@/components/Icons";

/**
 * Desktop: inline search field.
 * ≤768: icon button that expands to a full-row field so the placeholder is never clipped.
 */
export function TopbarSearch() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`topbar-search-wrap${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="topbar-icon-btn topbar-search-toggle"
        aria-label="Search"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <SearchIcon size={16} />
      </button>
      <div id={panelId} className="topbar-search" role="search">
        <SearchIcon size={14} />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search quotes, SOs, customers…"
          aria-label="Quick search"
          readOnly
        />
        <span className="kbd-shortcut">⌘K</span>
      </div>
    </div>
  );
}
