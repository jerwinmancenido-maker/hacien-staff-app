"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { BookIcon, BoxIcon, CartIcon, CoinIcon, FileIcon, GearIcon, HomeIcon, ListIcon, TruckIcon, UsersIcon } from "./Icons";
import { FALLBACK_SHORT_NAME } from "@/lib/settings/identity";

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
  { href: "/items", label: "Items", icon: <BoxIcon /> },
  { href: "/sales-orders", label: "Sales Orders", icon: <CartIcon /> },
  { href: "/purchase-orders", label: "Supplier POs", icon: <BoxIcon /> },
  { href: "/receiving", label: "Receiving", icon: <TruckIcon />, editOnly: true },
  { href: "/billing", label: "Billing & Collections", icon: <CoinIcon /> },
  { href: "/store-orders", label: "Store Orders", icon: <ListIcon /> },
  { href: "/payables", label: "Payables", icon: <CoinIcon />, payablesOnly: true },
  { href: "/cash", label: "Cash", icon: <CoinIcon />, cashOnly: true },
  { href: "/books", label: "Books", icon: <BookIcon />, booksOnly: true },
  { href: "/reminders", label: "Reminders", icon: <ListIcon /> },
];

const ADMIN: Item[] = [
  { href: "/settings", label: "Settings", icon: <GearIcon />, adminOnly: true },
  { href: "/messages", label: "Messages", icon: <ListIcon />, adminOnly: true },
  { href: "/backups", label: "Backups", icon: <ListIcon />, adminOnly: true },
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
  storeOrdersPaidCount = 0,
}: {
  isAdmin: boolean;
  canSeeCosts?: boolean;
  canEdit?: boolean;
  canViewBooks?: boolean;
  booksEnabled?: boolean;
  cashEnabled?: boolean;
  payablesEnabled?: boolean;
  storeOrdersPaidCount?: number;
}) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const render = (i: Item) => (
    <Link key={i.href} href={i.href} className={`nav-item${isActive(i.href) ? " active" : ""}${i.soon ? " soon" : ""}`} aria-current={isActive(i.href) ? "page" : undefined}>
      {i.icon}
      <span>{i.label}</span>
      {i.soon && <span className="soon-tag" title="Coming soon">soon</span>}
      {i.href === "/store-orders" && storeOrdersPaidCount > 0 && (
        <span className="nav-badge">{storeOrdersPaidCount > 99 ? "99+" : storeOrdersPaidCount}</span>
      )}
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
  account: "My account",
  password: "Change password",
  "two-step": "Two-step sign-in",
  customers: "Customers",
  suppliers: "Suppliers",
  contacts: "Contacts",
  settings: "Settings",
  users: "Users",
  audit: "Audit log",
  messages: "Messages",
  backups: "Backups",
  quotes: "Quotes",
  "sales-orders": "Sales Orders",
  "store-orders": "Store Orders",
  search: "Search",
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
  // Tax wording kept from tax-calendar-rules-02 (PR 18 had shorter Tax/Calendar/Income
  // labels to avoid "Record"; breadcrumbLabelsForPath still yields Books / Tax calendar
  // and Books / Tax worksheets).
  tax: "Tax worksheets",
  calendar: "Tax calendar",
  income: "1701Q",
  "2307-received": "2307s received",
  "ewt-withheld": "EWT withheld",
  "sales-summary": "Sales summary",
  operations: "Operations",
  reconciliation: "Reconciliation",
  items: "Items",
  dispatch: "Dispatch",
  reminders: "Reminders",
  profit: "Monthly profit",
  new: "New",
  edit: "Edit",
};

/** Record-id path segments (cuids) — the segment a record page's own label replaces. */
const RECORD_ID_SEGMENT = /^[a-z0-9]{20,}$/i;

/**
 * One path segment → its crumb label. A record id reads as the record's own
 * label (number or name) when the page supplies one via RecordBreadcrumbLabel;
 * with no label supplied the segment is dropped, so the trail ends at the
 * section name instead of the generic word "Detail" (finding 1113). The same
 * drop covers every other unknown segment — a bad record URL's id segment
 * (e.g. /quotes/abc, whose page answers notFound()) must not end the trail
 * in the generic word "Record" either (finding 1289).
 */
function crumbLabel(segment: string, recordLabel?: string): string | null {
  const known = CRUMB_LABELS[segment];
  if (known) return known;
  if (RECORD_ID_SEGMENT.test(segment)) return recordLabel ?? null;
  return null;
}

/** Tax calendar pages → "Books / Tax calendar"; worksheet pages → "Books / Tax worksheets". */
export function breadcrumbLabelsForPath(path: string, recordLabel?: string): string[] {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "books" && parts[1] === "tax" && parts[2] === "calendar") {
    return ["Books", "Tax calendar"];
  }
  if (parts[0] === "books" && parts[1] === "tax") {
    const rest = parts
      .slice(2)
      .map((s) => crumbLabel(s, recordLabel))
      .filter((l): l is string => l !== null);
    return ["Books", "Tax worksheets", ...rest.filter((l, i) => !(l === "Record" && rest[i - 1] === "Record"))];
  }
  const labels = (parts.length ? parts.map((s) => crumbLabel(s, recordLabel)) : ["Home"]).filter(
    (l): l is string => l !== null,
  );
  return labels.filter((l, i) => !(l === "Record" && labels[i - 1] === "Record"));
}

type RecordCrumbEntry = { path: string; label: string } | null;

const RecordCrumbContext = createContext<{
  entry: RecordCrumbEntry;
  setEntry: Dispatch<SetStateAction<RecordCrumbEntry>>;
}>({ entry: null, setEntry: () => {} });

/** Holds the current record page's own label for the breadcrumb (finding 1113). */
export function BreadcrumbLabelProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<RecordCrumbEntry>(null);
  return <RecordCrumbContext.Provider value={{ entry, setEntry }}>{children}</RecordCrumbContext.Provider>;
}

/**
 * A record page renders this with its own number or name; the breadcrumb's
 * record segment then shows that label instead of ending at the section name.
 */
export function RecordBreadcrumbLabel({ label }: { label: string }) {
  const path = usePathname();
  const { setEntry } = useContext(RecordCrumbContext);
  useEffect(() => {
    if (!path) return;
    setEntry({ path, label });
    return () => setEntry((cur) => (cur && cur.path === path && cur.label === label ? null : cur));
  }, [path, label, setEntry]);
  return null;
}

export function Breadcrumb({ rootLabel = FALLBACK_SHORT_NAME }: { rootLabel?: string }) {
  const path = usePathname();
  const { entry } = useContext(RecordCrumbContext);
  const recordLabel = entry && path && entry.path === path ? entry.label : undefined;
  const labels = breadcrumbLabelsForPath(path, recordLabel);
  const crumbs = [rootLabel, "Staff", ...labels];
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
