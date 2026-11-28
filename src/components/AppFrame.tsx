"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { MenuIcon, CloseIcon, PanelLeftIcon } from "@/components/Icons";

/**
 * App chrome: sidebar + topbar + content.
 * On narrow viewports the sidebar is a collapsed drawer opened from the menu button
 * (same pattern on every page — Home, Customers, Payables, …).
 * On desktop the sidebar can be hidden completely from the topbar toggle
 * (ERP adoption item 2); the choice is the signed-in user's own and is
 * remembered — the layout seeds it from the user record and the toggle
 * persists it back through onSidebarHiddenChange.
 */
export function AppFrame({
  sidebar,
  breadcrumb,
  topbarRight,
  initialSidebarHidden = false,
  onSidebarHiddenChange,
  children,
}: {
  sidebar: ReactNode;
  breadcrumb: ReactNode;
  topbarRight: ReactNode;
  initialSidebarHidden?: boolean;
  onSidebarHiddenChange?: (hidden: boolean) => void | Promise<void>;
  children: ReactNode;
}) {
  const path = usePathname();
  // Open only while path matches — navigating closes the drawer without an effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;
  const sidebarId = useId();
  const [sidebarHidden, setSidebarHidden] = useState(initialSidebarHidden);

  const toggleSidebar = () => {
    const next = !sidebarHidden;
    setSidebarHidden(next);
    void onSidebarHiddenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPath(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  return (
    <div className={`frame${open ? " nav-open" : ""}${sidebarHidden ? " sidebar-hidden" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
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
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!sidebarHidden}
            aria-controls={sidebarId}
            onClick={toggleSidebar}
          >
            <PanelLeftIcon size={18} />
          </button>
          {breadcrumb}
          <div className="right">{topbarRight}</div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
