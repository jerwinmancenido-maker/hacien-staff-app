import { redirect } from "next/navigation";

// S-84: the audit log moved into Settings as its own tab.
export default function AuditPage() {
  redirect("/settings?tab=audit");
}
