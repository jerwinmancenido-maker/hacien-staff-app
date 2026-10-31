import { PillTabs } from "@/components/PillTabs";

const TABS = [
  { key: "home", label: "Overview", href: "/payables" },
  { key: "payments", label: "Payments", href: "/payables/payments" },
  { key: "aging", label: "Aging", href: "/payables/aging" },
  { key: "2307", label: "2307 to issue", href: "/payables/2307" },
] as const;

export type PayablesTab = (typeof TABS)[number]["key"];

export function PayablesNav({ active }: { active: PayablesTab }) {
  return (
    <PillTabs
      active={active}
      tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.href }))}
      ariaLabel="Payables sections"
    />
  );
}
