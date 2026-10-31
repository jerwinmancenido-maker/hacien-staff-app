import { requirePagePermission } from "@/lib/auth/current-user";
import { isPayablesEnabled } from "@/lib/payables/features";
import { FeatureOffPage } from "@/components/FeatureOff";

export default async function PayablesLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("view");
  if (!(await isPayablesEnabled())) return <FeatureOffPage feature="Payables" />;
  return children;
}
