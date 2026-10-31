import { requirePagePermission } from "@/lib/auth/current-user";
import { isCashEnabled } from "@/lib/cash/features";
import { FeatureOffPage } from "@/components/FeatureOff";

export default async function CashLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("view");
  if (!(await isCashEnabled())) return <FeatureOffPage feature="Cash" />;
  return children;
}
