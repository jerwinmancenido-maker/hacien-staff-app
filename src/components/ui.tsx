// Small presentational pieces shared across pages (server-safe).

import type { ReactNode } from "react";
import Link from "next/link";
import { initials } from "@/lib/format";
import { InboxIcon } from "./Icons";

export type ChipTone = "green" | "amber" | "red" | "grey" | "dark";

export function Chip({ tone = "grey", children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`chip ${tone === "grey" ? "" : tone}`}>{children}</span>;
}

export function Avatar({ name, small, dark }: { name: string; small?: boolean; dark?: boolean }) {
  return (
    <span className={`avatar${small ? " sm" : ""}${dark ? " dark" : ""}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function EmptyState({
  title = "All clear here",
  line,
  action,
}: {
  title?: string;
  line: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="icon">
        <InboxIcon size={20} />
      </div>
      <div className="title">{title}</div>
      <div className="line">{line}</div>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function PageHeader({
  greeting,
  title,
  subtitle,
  actions,
  className,
}: {
  greeting?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional extra class (e.g. home-page-header for phone-only tightening). */
  className?: string;
}) {
  return (
    <div className={["page-header", className].filter(Boolean).join(" ")}>
      <div>
        {greeting && <div className="greeting">{greeting}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav className="tabs" aria-label="Tabs">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={`tab${t.key === active ? " active" : ""}`} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function PrimaryCell({ name, sub, avatar = true }: { name: string; sub?: ReactNode; avatar?: boolean }) {
  return (
    <div className="cell-primary">
      {avatar && <Avatar name={name} small />}
      <div>
        <div className="title">{name}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </div>
  );
}
