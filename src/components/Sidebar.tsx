"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BookIcon, BoxIcon, CartIcon, CoinIcon, FileIcon, GearIcon, HomeIcon, ListIcon, TruckIcon, UsersIcon } from "./Icons";

type Item = { href: string; label: string; icon: ReactNode; soon?: boolean; adminOnly?: boolean };

const MAIN: Item[] = [
  { href: "/", label: "Home", icon: <HomeIcon /> },
  { href: "/customers", label: "Customers", icon: <UsersIcon /> },
  { href: "/suppliers", label: "Suppliers", icon: <TruckIcon /> },
];

const LATER: Item[] = [
  { href: "/quotes", label: "Quotes", icon: <FileIcon />, soon: true },
  { href: "/sales-orders", label: "Sales Orders", icon: <CartIcon />, soon: true },
  { href: "/supplier-pos", label: "Supplier POs", icon: <BoxIcon />, soon: true },
  { href: "/billing", label: "Billing & Collections", icon: <CoinIcon />, soon: true },
  { href: "/books", label: "Books", icon: <BookIcon />, soon: true },
];

const ADMIN: Item[] = [
  { href: "/settings", label: "Settings", icon: <GearIcon />, adminOnly: true },
  { href: "/audit", label: "Audit log", icon: <ListIcon />, adminOnly: true },
];

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const render = (i: Item) => (
    <Link key={i.href} href={i.href} className={`nav-item${isActive(i.href) ? " active" : ""}${i.soon ? " soon" : ""}`} aria-current={isActive(i.href) ? "page" : undefined}>
      {i.icon}
      <span>{i.label}</span>
      {i.soon && <span className="soon-tag" title="Coming soon">soon</span>}
    </Link>
  );
  return (
    <nav aria-label="Main">
      {MAIN.map(render)}
      <div className="nav-label">Deals</div>
      {LATER.map(render)}
      {isAdmin && (
        <>
          <div className="nav-label">Admin</div>
          {ADMIN.map(render)}
        </>
      )}
    </nav>
  );
}

const CRUMB_LABELS: Record<string, string> = {
  customers: "Customers",
  suppliers: "Suppliers",
  contacts: "Contacts",
  settings: "Settings",
  users: "Users",
  audit: "Audit log",
  quotes: "Quotes",
  "sales-orders": "Sales Orders",
  "supplier-pos": "Supplier POs",
  billing: "Billing & Collections",
  books: "Books",
  new: "New",
};

export function Breadcrumb() {
  const path = usePathname();
  const parts = path.split("/").filter(Boolean);
  const labels = parts.length ? parts.map((p) => CRUMB_LABELS[p] ?? "Record") : ["Home"];
  // Collapse repeated "Record" crumbs.
  const crumbs = ["HACIEN", "Staff", ...labels.filter((l, i) => !(l === "Record" && labels[i - 1] === "Record"))];
  return (
    <div className="crumbs">
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 && " / "}
          {i === crumbs.length - 1 ? <b>{c}</b> : c}
        </span>
      ))}
    </div>
  );
}
