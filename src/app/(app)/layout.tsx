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
import { currentSessionLimits } from "@/lib/auth/session";
import { IdleSignOut } from "@/components/IdleSignOut";
import { idleRemainingMs, signOut } from "../auth-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { AppFrame } from "@/components/AppFrame";
import { BrandLogo } from "@/components/BrandLogo";
import { Breadcrumb, SidebarNav } from "@/components/Sidebar";
import { Avatar } from "@/components/ui";
import { NotificationsBell } from "@/components/NotificationsBell";
import { getNotifications } from "@/lib/notifications";
import { TopbarSearch } from "@/components/TopbarSearch";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sessionLimits = await currentSessionLimits();
  const { settings } = await getSettingsSnapshot();
  const [cashEnabled, payablesEnabled] = await Promise.all([isCashEnabled(), isPayablesEnabled()]);
  // Gross sales = non-voided Part 5 billing totals YTD (see src/lib/services/non-vat.ts).
  const meter = await getNonVatMeter(settings.taxYear);
  const milestoneMessage = NON_VAT_MESSAGES[meter.level];
  const booksEnabled = await isBooksEnabled();
  const milestoneTitle = homeNonVatTitle();
  const canOpenSettings = can(user, "manage_settings");

  const sidebar = (
    <>
      <div className="brand">
        <Link href="/" className="brand-link" aria-label="HACIEN home">
          <BrandLogo variant="wordmark" />
        </Link>
      </div>
      <SidebarNav
        isAdmin={canOpenSettings}
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
        aria-label={milestoneTitle}
        data-level={meter.level}
      >
        <div className="label tracker-head">
          <span>{milestoneTitle}</span>
          <b className="num tracker-pct">{meter.pctLabel}</b>
        </div>
        <div className="value" style={{ textAlign: "left" }}>
          <span className="num">{formatPeso(meter.used)}</span>{" "}
          <span className="faint small tracker-of">of {formatPesoLimit(meter.limit)}</span>
        </div>
        <div
          className="bar"
          role="meter"
          aria-label="Sales milestone progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(meter.barPct)}
          aria-valuetext={`${meter.pctLabel} of ${formatPesoLimit(meter.limit)}`}
        >
          <span style={{ width: `${meter.barPct}%` }} />
        </div>
        {milestoneMessage ? (
          <div className="tracker-message small" role="status">
            {milestoneMessage}
          </div>
        ) : (
          <div className="faint small" style={{ marginTop: 6 }}>
            Milestones at {meter.warnFirstPct}%, {meter.warnSecondPct}% and 100%
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

  const notifications = await getNotifications(user);
  const topbarRight = (
    <>
      <TopbarSearch />
      <NotificationsBell sections={notifications} />
      <AccountMenu
        name={user.name}
        role={roleLabel(user)}
        showSettings={canOpenSettings}
        signOutAction={signOut}
      />
    </>
  );

  return (
    <AppFrame sidebar={sidebar} breadcrumb={<Breadcrumb />} topbarRight={topbarRight}>
      <IdleSignOut idleMs={sessionLimits.idleMs} signOutAction={signOut} remainingMs={idleRemainingMs} />
      {children}
    </AppFrame>
  );
}
