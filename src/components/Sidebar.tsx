"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BookIcon, BoxIcon, CartIcon, CoinIcon, FileIcon, GearIcon, HomeIcon, ListIcon, TruckIcon, UsersIcon } from "./Icons";

type Item = {
  href: string;
  label: string;
  icon: ReactNode;
  soon?: boolean;
  adminOnly?: boolean;
  costsOnly?: boolean;
  editOnly?: boolean;
  booksOnly?: boolean;
  cashOnly?: boolean;
  payablesOnly?: boolean;
};

const MAIN: Item[] = [
  { href: "/", label: "Home", icon: <HomeIcon /> },
  { href: "/customers", label: "Customers", icon: <UsersIcon /> },
  { href: "/suppliers", label: "Suppliers", icon: <TruckIcon /> },
];

const LATER: Item[] = [
  { href: "/quotes", label: "Quotes", icon: <FileIcon /> },
  { href: "/sales-orders", label: "Sales Orders", icon: <CartIcon /> },
  { href: "/purchase-orders", label: "Supplier POs", icon: <BoxIcon />, costsOnly: true },
  { href: "/receiving", label: "Receiving", icon: <TruckIcon />, editOnly: true },
  { href: "/billing", label: "Billing & Collections", icon: <CoinIcon /> },
  { href: "/payables", label: "Payables", icon: <CoinIcon />, payablesOnly: true },
  { href: "/cash", label: "Cash", icon: <CoinIcon />, cashOnly: true },
  { href: "/books", label: "Books", icon: <BookIcon />, booksOnly: true },
];

const ADMIN: Item[] = [
  { href: "/settings", label: "Settings", icon: <GearIcon />, adminOnly: true },
  { href: "/audit", label: "Audit log", icon: <ListIcon />, adminOnly: true },
];

type DealsNavFlags = {
  canSeeCosts?: boolean;
  canEdit?: boolean;
  cashEnabled?: boolean;
  payablesEnabled?: boolean;
  booksEnabled?: boolean;
  canViewBooks?: boolean;
};

/** Pure filter for Deals nav — unit-tested for CASH / PAYABLES / BOOKS feature gating. */
export function filterDealsNavItems<
  T extends {
    costsOnly?: boolean;
    editOnly?: boolean;
    cashOnly?: boolean;
    payablesOnly?: boolean;
    booksOnly?: boolean;
  },
>(items: readonly T[], flags: DealsNavFlags): T[] {
  const {
    canSeeCosts = false,
    canEdit = false,
    cashEnabled = false,
    payablesEnabled = false,
    booksEnabled = false,
    canViewBooks = false,
  } = flags;
  return items.filter(
    (i) =>
      (!i.costsOnly || canSeeCosts) &&
      (!i.editOnly || canEdit) &&
      (!i.cashOnly || cashEnabled) &&
      (!i.payablesOnly || payablesEnabled) &&
      (!i.booksOnly || (booksEnabled && canViewBooks)),
  );
}

/** Href list for Deals section under the given feature / role flags. */
export function dealsNavHrefs(flags: DealsNavFlags): string[] {
  return filterDealsNavItems(LATER, flags).map((i) => i.href);
}

export function SidebarNav({
  isAdmin,
  canSeeCosts = false,
  canEdit = false,
  canViewBooks = false,
  booksEnabled = false,
  cashEnabled = false,
  payablesEnabled = false,
}: {
  isAdmin: boolean;
  canSeeCosts?: boolean;
  canEdit?: boolean;
  canViewBooks?: boolean;
  booksEnabled?: boolean;
  cashEnabled?: boolean;
  payablesEnabled?: boolean;
}) {
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
      {filterDealsNavItems(LATER, {
        canSeeCosts,
        canEdit,
        cashEnabled,
        payablesEnabled,
        booksEnabled,
        canViewBooks,
      }).map(render)}
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
  "purchase-orders": "Supplier POs",
  receiving: "Receiving",
  bill: "Record bill",
  billing: "Billing & Collections",
  billings: "Billings",
  collections: "Collections",
  aging: "Aging",
  booklet: "Booklet",
  "2307": "2307s",
  payables: "Payables",
  payments: "Payments",
  cash: "Cash",
  accounts: "Accounts",
  expenses: "Expenses",
  transfers: "Transfers",
  ledger: "Ledger",
  books: "Books",
  sales: "Sales",
  disbursements: "Cash disbursements",
  purchases: "Purchases",
  journal: "General journal",
  tax: "Tax worksheets",
  calendar: "Tax calendar",
  income: "1701Q",
  "2307-received": "2307s received",
  "ewt-withheld": "EWT withheld",
  "sales-summary": "Sales summary",
  new: "New",
  edit: "Edit",
};

/** Tax calendar pages → "Books / Tax calendar"; worksheet pages → "Books / Tax worksheets". */
export function breadcrumbLabelsForPath(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "books" && parts[1] === "tax" && parts[2] === "calendar") {
    return ["Books", "Tax calendar"];
  }
  if (parts[0] === "books" && parts[1] === "tax") {
    const rest = parts.slice(2).map((p) => CRUMB_LABELS[p] ?? "Record");
    return ["Books", "Tax worksheets", ...rest.filter((l, i) => !(l === "Record" && rest[i - 1] === "Record"))];
  }
  const labels = parts.length ? parts.map((p) => CRUMB_LABELS[p] ?? "Record") : ["Home"];
  return labels.filter((l, i) => !(l === "Record" && labels[i - 1] === "Record"));
}

export function Breadcrumb() {
  const path = usePathname();
  const labels = breadcrumbLabelsForPath(path);
  const crumbs = ["HACIEN", "Staff", ...labels];
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
