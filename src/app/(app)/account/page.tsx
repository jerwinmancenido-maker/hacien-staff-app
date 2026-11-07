import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { roleLabel } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="My account" subtitle="Your sign-in details. Only you can change these." />
      <div className="card" style={{ maxWidth: 640 }}>
        <dl className="kv kv-grid">
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Position</dt>
          <dd>{user.position ?? <span className="faint">—</span>}</dd>
          <dt>Roles</dt>
          <dd>{roleLabel(user)}</dd>
          <dt>Two-step sign-in</dt>
          <dd>{user.totpSecret ? "On" : "Off"}</dd>
        </dl>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <Link className="btn btn-secondary" href="/account/password">
            Change password
          </Link>
          <Link className="btn btn-secondary" href="/account/two-step">
            Two-step sign-in
          </Link>
        </div>
      </div>
    </>
  );
}
