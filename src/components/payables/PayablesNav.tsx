import { PillTabs } from "@/components/PillTabs";
import { isPayables2307Enabled } from "@/lib/payables/issue2307";

export const PAYABLES_NAV_TABS = [
  { key: "home", label: "Overview", href: "/payables" },
  { key: "payments", label: "Payments", href: "/payables/payments" },
  { key: "aging", label: "Aging", href: "/payables/aging" },
  { key: "2307", label: "2307 to issue", href: "/payables/2307" },
] as const;

export type PayablesTab = (typeof PAYABLES_NAV_TABS)[number]["key"];

/** Pure filter — unit-tested: 2307 tab hidden when the withholding-agent flag is off. */
export function visiblePayablesNavTabs(issue2307Enabled: boolean) {
  return PAYABLES_NAV_TABS.filter((t) => t.key !== "2307" || issue2307Enabled).map((t) => ({
    key: t.key,
    label: t.label,
    href: t.href,
  }));
}

/** Tabs for Payables. The 2307 tab is gated by PAYABLES_2307_ENABLED (off by default). */
export async function PayablesNav({ active }: { active: PayablesTab }) {
  const show2307 = await isPayables2307Enabled();
  return (
    <PillTabs active={active} tabs={visiblePayablesNavTabs(show2307)} ariaLabel="Payables sections" />
  );
}
