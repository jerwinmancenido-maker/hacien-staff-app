import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isPayablesEnabled } from "@/lib/payables/features";

export default async function PayablesLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("view");
  if (!(await isPayablesEnabled())) notFound();
  return children;
}
