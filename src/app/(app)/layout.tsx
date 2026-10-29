import { requireUser } from "@/lib/auth/current-user";
import { can, roleLabel } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { formatPeso } from "@/lib/format";
import { signOut } from "../auth-actions";
import { Breadcrumb, SidebarNav } from "@/components/Sidebar";
import { Avatar } from "@/components/ui";
import { LogoutIcon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { settings } = await getSettingsSnapshot();
  const limit = settings.taxYear.nonVatLimit;
  // Sales tracking arrives with Billing; the tracker shows ₱0 until then.
  const used = 0;
  const pct = Math.min(100, (used / limit) * 100);

  return (
    <div className="frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">H</span>
          <span>HACIEN</span>
        </div>
        <SidebarNav isAdmin={can(user, "manage_settings")} />
        <div className="sidebar-spacer" />
        <div className="tracker-card" aria-label="Non-VAT limit tracker">
          <div className="label">Non-VAT limit · {settings.taxYear.year}</div>
          <div className="value num" style={{ textAlign: "left" }}>
            {formatPeso(used)} <span className="faint small">of {formatPeso(limit)}</span>
          </div>
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="faint small" style={{ marginTop: 6 }}>
            Warns at {settings.taxYear.warnFirstPct}% and {settings.taxYear.warnSecondPct}%
          </div>
        </div>
        <div className="user-row">
          <Avatar name={user.name} dark />
          <div className="who">
            <div className="strong">{user.name}</div>
            <div className="small muted">{roleLabel(user)}</div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Breadcrumb />
          <div className="right">
            <span className="user-name">{user.name}</span>
            <form action={signOut}>
              <button className="btn btn-secondary btn-sm" type="submit">
                <LogoutIcon size={14} /> Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
