"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SearchIcon } from "@/components/Icons";
import { normalizeTopSearchQuery, topSearchListHref } from "@/lib/search/top-search";

function subscribeNarrow(callback: () => void) {
  const mq = window.matchMedia("(max-width: 768px)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

/**
 * Desktop: inline search field.
 * ≤768: icon button that expands to a full-row field so the placeholder is never clipped.
 * On /search itself the panel is open by route at ≤768 — that page has no input of
 * its own, so the collapsed state would leave it with no visible box (finding 1107).
 * Enter (2+ chars) → /search?q=…; ⌘K / Ctrl+K focuses the box; Escape closes the phone panel.
 */
export function TopbarSearch() {
  const [intent, setIntent] = useState<{ path: string; open: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia("(max-width: 768px)").matches,
    () => false,
  );

  // Finding 1107: the /search page renders no search input of its own — this
  // header field is its only box, and at ≤768 it sits collapsed behind the
  // toggle. The panel state is derived per route (the AppFrame drawer
  // pattern): an explicit toggle/Escape choice on the current route wins;
  // otherwise the panel is open exactly when the route is /search at phone
  // width — the same full-row field the toggle opens, visible on arrival —
  // and closed everywhere else, exactly as before. One search surface at
  // every width; no phone-only duplicate.
  const userOpen = intent && intent.path === pathname ? intent.open : null;
  const open = userOpen !== null ? userOpen : pathname === "/search" && narrow;
  const setOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setIntent({ path: pathname, open: typeof v === "function" ? v(open) : v }),
    [pathname, open],
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

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
  }, [setOpen]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = normalizeTopSearchQuery(inputRef.current?.value);
    if (!q) return;
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
