"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/Icons";
import { normalizeTopSearchQuery, topSearchListHref } from "@/lib/search/top-search";

/**
 * Desktop: inline search field.
 * ≤768: icon button that expands to a full-row field so the placeholder is never clipped.
 * Enter (2+ chars) → /search?q=…; ⌘K / Ctrl+K focuses the box; Escape closes the phone panel.
 */
export function TopbarSearch() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const onHotkey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      const narrow = window.matchMedia("(max-width: 768px)").matches;
      if (narrow) setOpen(true);
      else inputRef.current?.focus();
    };
    window.addEventListener("keydown", onHotkey);
    return () => window.removeEventListener("keydown", onHotkey);
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = normalizeTopSearchQuery(inputRef.current?.value);
    if (!q) return;
    setOpen(false);
    router.push(topSearchListHref("/search", q));
  }

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
      <form id={panelId} className="topbar-search" role="search" action="/search" method="get" onSubmit={onSubmit}>
        <SearchIcon size={14} />
        <input
          ref={inputRef}
          type="search"
          name="q"
          placeholder="Search quotes, SOs, customers…"
          aria-label="Quick search"
          autoComplete="off"
          enterKeyHint="search"
        />
        <span className="kbd-shortcut" aria-hidden>
          ⌘K
        </span>
      </form>
    </div>
  );
}
