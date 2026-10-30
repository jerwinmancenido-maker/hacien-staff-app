import { requireUser } from "@/lib/auth/current-user";
import { can, canSeeCosts, roleLabel } from "@/lib/permissions";
import { isCashEnabled } from "@/lib/cash/features";
import { getSettingsSnapshot } from "@/lib/settings";
import { formatPeso } from "@/lib/format";
import { isBooksEnabled } from "@/lib/books/features";
import { getNonVatMeter, NON_VAT_MESSAGES } from "@/lib/services/non-vat";
import { signOut } from "../auth-actions";
import { Breadcrumb, SidebarNav } from "@/components/Sidebar";
import { Avatar } from "@/components/ui";
import { BellIcon, LogoutIcon, SearchIcon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { settings } = await getSettingsSnapshot();
  const cashEnabled = await isCashEnabled();
  // Gross sales = non-voided Part 5 billing totals YTD (see src/lib/services/non-vat.ts).
  const meter = await getNonVatMeter(settings.taxYear);
  const warning = NON_VAT_MESSAGES[meter.level];
  const booksEnabled = await isBooksEnabled();

  return (
    <div className="frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">H</span>
          <span>HACIEN</span>
        </div>
        <SidebarNav
          isAdmin={can(user, "manage_settings")}
          canSeeCosts={canSeeCosts(user)}
          canEdit={can(user, "edit_data")}
          canViewBooks={can(user, "view_books")}
          booksEnabled={booksEnabled}
          cashEnabled={cashEnabled}
        />
        <div className="sidebar-spacer" />
        <div className={`tracker-card level-${meter.level}`} aria-label="Non-VAT limit tracker" data-level={meter.level}>
          <div className="label tracker-head">
            <span>Non-VAT limit · {meter.year}</span>
            <b className="num tracker-pct">{meter.pctLabel}</b>
          </div>
          <div className="value num" style={{ textAlign: "left" }}>
            {formatPeso(meter.used)} <span className="faint small">of {formatPeso(meter.limit)}</span>
          </div>
          <div
            className="bar"
            role="meter"
            aria-label="Share of the non-VAT limit used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(meter.barPct)}
            aria-valuetext={`${meter.pctLabel} of ${formatPeso(meter.limit)}`}
          >
            <span style={{ width: `${meter.barPct}%` }} />
          </div>
          {warning ? (
            <div className="tracker-warning small" role="status">
              {warning}
            </div>
          ) : (
            <div className="faint small" style={{ marginTop: 6 }}>
              Warns at {meter.warnFirstPct}% and {meter.warnSecondPct}%
            </div>
          )}
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
            <div className="topbar-search">
              <SearchIcon size={14} />
              <input type="text" placeholder="Search quotes, SOs, customers…" aria-label="Quick search" readOnly />
              <span className="kbd-shortcut">⌘K</span>
            </div>
            <button type="button" className="topbar-icon-btn" aria-label="Notifications" title="Notifications">
              <BellIcon size={16} />
            </button>
            <Avatar name={user.name} small dark />
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
