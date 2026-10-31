import { PillTabs } from "@/components/PillTabs";

const TABS = [
  { key: "home", label: "Overview", href: "/cash" },
  { key: "accounts", label: "Accounts", href: "/cash/accounts" },
  { key: "expenses", label: "Expenses", href: "/cash/expenses" },
  { key: "transfers", label: "Transfers", href: "/cash/transfers" },
  { key: "ledger", label: "Ledger", href: "/cash/ledger" },
] as const;

export type CashTab = (typeof TABS)[number]["key"];

export function CashNav({ active }: { active: CashTab }) {
  return (
    <PillTabs
      active={active}
      tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.href }))}
      ariaLabel="Cash sections"
    />
  );
}
