import { PillTabs } from "@/components/PillTabs";
import { REGISTER_CONFIGS, type RegisterKey } from "@/lib/books/config";

const TABS: { key: "home" | RegisterKey | "tax" | "tax-calendar" | "profit" | "reconciliation" | "operations"; label: string; href: string }[] = [
  { key: "home", label: "Overview", href: "/books" },
  { key: "sales", label: REGISTER_CONFIGS.sales.label, href: "/books/sales" },
  { key: "disbursements", label: REGISTER_CONFIGS.disbursements.label, href: "/books/disbursements" },
  { key: "purchases", label: REGISTER_CONFIGS.purchases.label, href: "/books/purchases" },
  { key: "journal", label: REGISTER_CONFIGS.journal.label, href: "/books/journal" },
  { key: "tax", label: "Tax worksheets", href: "/books/tax" },
  { key: "tax-calendar", label: "Tax calendar", href: "/books/tax/calendar" },
  { key: "profit", label: "Monthly profit", href: "/books/profit" },
  { key: "reconciliation", label: "Reconciliation", href: "/books/reconciliation" },
  { key: "operations", label: "Operations", href: "/books/operations" },
];

export type BooksTab = (typeof TABS)[number]["key"];

export function BooksNav({ active }: { active: BooksTab }) {
  return (
    <PillTabs
      className="books-nav"
      active={active}
      tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.href }))}
      ariaLabel="Books sections"
    />
  );
}
