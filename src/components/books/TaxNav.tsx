import { PillTabs } from "@/components/PillTabs";
import { TAX_WORKSHEET_PAGES } from "@/lib/tax/constants";

const TABS = [
  TAX_WORKSHEET_PAGES.home,
  TAX_WORKSHEET_PAGES.income,
  TAX_WORKSHEET_PAGES.received2307,
  TAX_WORKSHEET_PAGES.supplierEwt,
  TAX_WORKSHEET_PAGES.salesSummary,
] as const;

export type TaxTab = (typeof TABS)[number]["key"];

export function TaxNav({ active }: { active: TaxTab }) {
  return (
    <PillTabs
      active={active}
      tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.href }))}
      ariaLabel="Tax worksheet sections"
    />
  );
}
