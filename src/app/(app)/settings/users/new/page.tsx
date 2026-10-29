import { requirePagePermission } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/ui";
import { UserForm } from "../../UserForm";
import { createUserAction } from "../../actions";

export default async function NewUserPage() {
  await requirePagePermission("manage_users");
  return (
    <>
      <PageHeader title="Add user" subtitle="They'll get an email with a link to set their password." />
      <div className="card" style={{ maxWidth: 760 }}>
        <UserForm user={null} action={createUserAction} />
      </div>
    </>
  );
}
