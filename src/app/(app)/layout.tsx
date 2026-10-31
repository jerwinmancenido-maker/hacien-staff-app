import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { can, canSeeCosts, roleLabel } from "@/lib/permissions";
import { isCashEnabled } from "@/lib/cash/features";
import { isPayablesEnabled } from "@/lib/payables/features";
import { getSettingsSnapshot } from "@/lib/settings";
import { formatPeso, formatPesoLimit } from "@/lib/format";
import { homeNonVatTitle } from "@/lib/home/nonVatCopy";
import { isBooksEnabled } from "@/lib/books/features";
import { getNonVatMeter, NON_VAT_MESSAGES } from "@/lib/services/non-vat";
import { signOut } from "../auth-actions";
import { AppFrame } from "@/components/AppFrame";
import { BrandLogo } from "@/components/BrandLogo";
import { Breadcrumb, SidebarNav } from "@/components/Sidebar";
import { Avatar } from "@/components/ui";
import { BellIcon, LogoutIcon, SearchIcon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { settings } = await getSettingsSnapshot();
  const [cashEnabled, payablesEnabled] = await Promise.all([isCashEnabled(), isPayablesEnabled()]);
  // Gross sales = non-voided Part 5 billing totals YTD (see src/lib/services/non-vat.ts).
  const meter = await getNonVatMeter(settings.taxYear);
  const warning = NON_VAT_MESSAGES[meter.level];
  const booksEnabled = await isBooksEnabled();
  const nonVatTitle = homeNonVatTitle(meter.limit);

  const sidebar = (
    <>
      <div className="brand">
        <Link href="/" className="brand-link" aria-label="HACIEN home">
          <BrandLogo variant="wordmark" />
        </Link>
      </div>
      <SidebarNav
        isAdmin={can(user, "manage_settings")}
        canSeeCosts={canSeeCosts(user)}
        canEdit={can(user, "edit_data")}
        canViewBooks={can(user, "view_books")}
        booksEnabled={booksEnabled}
        cashEnabled={cashEnabled}
        payablesEnabled={payablesEnabled}
      />
      <div className="sidebar-spacer" />
      <a
        href="/billing"
        className={`tracker-card level-${meter.level}`}
        aria-label={nonVatTitle}
        data-level={meter.level}
      >
        <div className="label tracker-head">
          <span>{nonVatTitle}</span>
          <b className="num tracker-pct">{meter.pctLabel}</b>
        </div>
        <div className="value" style={{ textAlign: "left" }}>
          <span className="num">{formatPeso(meter.used)}</span>{" "}
          <span className="faint small tracker-of">of {formatPesoLimit(meter.limit)}</span>
        </div>
        <div
          className="bar"
          role="meter"
          aria-label="Share of the non-VAT limit used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(meter.barPct)}
          aria-valuetext={`${meter.pctLabel} of ${formatPesoLimit(meter.limit)}`}
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
      </a>
      <div className="user-row">
        <Avatar name={user.name} dark />
        <div className="who">
          <div className="strong">{user.name}</div>
          <div className="small muted">{roleLabel(user)}</div>
        </div>
      </div>
    </>
  );

  const topbarRight = (
    <>
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
    </>
  );

  return (
    <AppFrame sidebar={sidebar} breadcrumb={<Breadcrumb />} topbarRight={topbarRight}>
      {children}
    </AppFrame>
  );
}
