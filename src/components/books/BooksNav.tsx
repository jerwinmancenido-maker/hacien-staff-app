import { PillTabs } from "@/components/PillTabs";
import { REGISTER_CONFIGS, type RegisterKey } from "@/lib/books/config";

const TABS: { key: "home" | RegisterKey | "tax"; label: string; href: string }[] = [
  { key: "home", label: "Overview", href: "/books" },
  { key: "sales", label: REGISTER_CONFIGS.sales.label, href: "/books/sales" },
  { key: "disbursements", label: REGISTER_CONFIGS.disbursements.label, href: "/books/disbursements" },
  { key: "purchases", label: REGISTER_CONFIGS.purchases.label, href: "/books/purchases" },
  { key: "journal", label: REGISTER_CONFIGS.journal.label, href: "/books/journal" },
  { key: "tax", label: "Tax worksheets", href: "/books/tax" },
];

export type BooksTab = (typeof TABS)[number]["key"];

export function BooksNav({ active }: { active: BooksTab }) {
  return (
    <PillTabs
      active={active}
      tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.href }))}
      ariaLabel="Books sections"
    />
  );
}
