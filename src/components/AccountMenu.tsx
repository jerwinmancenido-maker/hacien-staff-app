"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui";
import { accountMenuNavItems } from "@/lib/account-menu";

type SignOutAction = () => void | Promise<void>;

/**
 * Topbar account control: avatar (+ name on wider screens) opens a menu with
 * name/role, optional Settings (manage_settings), and Sign out for every role.
 */
export function AccountMenu({
  name,
  role,
  showSettings,
  signOutAction,
}: {
  name: string;
  role: string;
  showSettings: boolean;
  signOutAction: SignOutAction;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const navItems = accountMenuNavItems(showSettings);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function onDocPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        // Same as Escape: close and return focus to the avatar trigger.
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onDocKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onDocKey);

    const id = window.requestAnimationFrame(() => {
      menuItems()[0]?.focus();
    });
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onDocKey);
    };
  }, [open]);

  function menuItems(): HTMLElement[] {
    if (!menuRef.current) return [];
    return [...menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      // Keep focus inside the menu; Shift+Tab from first / Tab from last closes.
      if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        close(true);
      } else if (e.shiftKey && i <= 0) {
        e.preventDefault();
        close(true);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
  }

  return (
    <div className={`account-menu${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <Avatar name={name} small dark />
        <span className="account-menu-name">{name}</span>
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          className="account-menu-panel"
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
        >
          <div className="account-menu-who" role="presentation">
            <div className="account-menu-who-name">{name}</div>
            <div className="account-menu-who-role">{role}</div>
          </div>
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="account-menu-item"
              role="menuitem"
              onClick={() => close(false)}
            >
              {item.label}
            </Link>
          ))}
          <div className="account-menu-divider" role="separator" />
          <form action={signOutAction} className="account-menu-signout-form">
            <button type="submit" className="account-menu-item account-menu-signout" role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
