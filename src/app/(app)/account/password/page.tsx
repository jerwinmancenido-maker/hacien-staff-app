import { requireUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/ui";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Change password" subtitle="Use at least 10 characters. Your other sessions are signed out." />
      <div className="card" style={{ maxWidth: 480 }}>
        <ChangePasswordForm />
      </div>
    </>
  );
}
