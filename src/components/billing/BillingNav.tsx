import { PillTabs } from "@/components/PillTabs";

const TABS = [
  { key: "home", label: "Overview", href: "/billing" },
  { key: "billings", label: "Billings", href: "/billing/billings" },
  { key: "collections", label: "Collections", href: "/billing/collections" },
  { key: "aging", label: "Aging", href: "/billing/aging" },
  { key: "2307", label: "2307s", href: "/billing/2307" },
  { key: "booklet", label: "Booklet", href: "/billing/booklet" },
] as const;

export type BillingTab = (typeof TABS)[number]["key"];

export function BillingNav({ active }: { active: BillingTab }) {
  return (
    <PillTabs
      active={active}
      tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.href }))}
      ariaLabel="Billing sections"
    />
  );
}
