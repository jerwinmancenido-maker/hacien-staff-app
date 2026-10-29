import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { Activity } from "@/components/Activity";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Chip, PageHeader } from "@/components/ui";
import { UserForm } from "../../UserForm";
import { resendInviteAction, setUserActiveAction, updateUserAction } from "../../actions";

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invited?: string }> }) {
  const me = await requirePagePermission("manage_users");
  const { id } = await params;
  const { invited } = await searchParams;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) notFound();
  return (
    <>
      <PageHeader
        title={
          <>
            {user.name}
            {!user.active ? <Chip tone="red">Turned off</Chip> : !user.passwordHash ? <Chip tone="amber">Invited</Chip> : <Chip tone="green">Active</Chip>}
          </>
        }
        subtitle={`${user.email} · ${roleLabel(user)}`}
        actions={
          <>
            {user.active && !user.passwordHash && <ConfirmAction action={resendInviteAction.bind(null, id)} label="Resend invite" title="Send the invite again?" body="A new set-password link is emailed. Older links keep working until they expire." confirmLabel="Send" />}
            {user.active ? (
              user.id !== me.id && (
                <ConfirmAction
                  action={setUserActiveAction.bind(null, id, false)}
                  label="Turn off user"
                  title="Turn off this user?"
                  body="They can't sign in any more. Their history stays."
                  confirmLabel="Turn off"
                  danger
                />
              )
            ) : (
              <ConfirmAction action={setUserActiveAction.bind(null, id, true)} label="Turn on user" title="Turn this user back on?" body="They can sign in again." confirmLabel="Turn on" />
            )}
          </>
        }
      />
      {invited && <div className="alert ok">User added. We emailed them a link to set their password.</div>}
      <div className="detail-grid">
        <div className="card">
          <UserForm user={user} action={updateUserAction.bind(null, id)} />
        </div>
        <Activity targets={[{ entityType: "User", ids: [id] }]} />
      </div>
    </>
  );
}
