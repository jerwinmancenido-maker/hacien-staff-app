import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isCashEnabled } from "@/lib/cash/features";

export default async function CashLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("view");
  if (!(await isCashEnabled())) notFound();
  return children;
}
