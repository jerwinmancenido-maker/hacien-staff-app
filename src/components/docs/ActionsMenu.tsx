"use client";

// "Actions ▾" dropdown used at the top right of quote and sales order pages.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type MenuItem = {
  key: string;
  label: string;
  href?: string;
  newTab?: boolean;
  onSelect?: () => void;
  danger?: boolean;
};

export function ActionsMenu({ items, label = "Actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.length) return null;
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((i) =>
            i.href ? (
              <Link
                key={i.key}
                role="menuitem"
                href={i.href}
                className={`menu-item${i.danger ? " danger" : ""}`}
                target={i.newTab ? "_blank" : undefined}
                rel={i.newTab ? "noopener" : undefined}
                onClick={() => setOpen(false)}
              >
                {i.label}
              </Link>
            ) : (
              <button
                key={i.key}
                role="menuitem"
                type="button"
                className={`menu-item${i.danger ? " danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  i.onSelect?.();
                }}
              >
                {i.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
