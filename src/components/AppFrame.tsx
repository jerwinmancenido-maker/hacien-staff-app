"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { MenuIcon, CloseIcon } from "@/components/Icons";

/**
 * App chrome: sidebar + topbar + content.
 * On narrow viewports the sidebar is a collapsed drawer opened from the menu button
 * (same pattern on every page — Home, Customers, Payables, …).
 */
export function AppFrame({
  sidebar,
  breadcrumb,
  topbarRight,
  children,
}: {
  sidebar: ReactNode;
  breadcrumb: ReactNode;
  topbarRight: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  // Open only while path matches — navigating closes the drawer without an effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;
  const sidebarId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPath(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`frame${open ? " nav-open" : ""}`}>
      <button
        type="button"
        className="nav-backdrop"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpenPath(null)}
      />
      <aside id={sidebarId} className="sidebar">
        {sidebar}
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="nav-toggle"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls={sidebarId}
            onClick={() => setOpenPath(open ? null : path)}
          >
            {open ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
          </button>
          {breadcrumb}
          <div className="right">{topbarRight}</div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
