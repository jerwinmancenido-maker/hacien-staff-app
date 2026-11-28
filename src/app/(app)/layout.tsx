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
import { withConnectionRetry } from "@/lib/connection-retry";
import { IdleSignOut } from "@/components/IdleSignOut";
import { idleRemainingMs, signOut } from "../auth-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { AppFrame } from "@/components/AppFrame";
import { BrandLogo } from "@/components/BrandLogo";
import { Breadcrumb, BreadcrumbLabelProvider, SidebarNav } from "@/components/Sidebar";
import { setSidebarHiddenAction } from "./account/actions";
import { Avatar } from "@/components/ui";
import { NotificationsBell } from "@/components/NotificationsBell";
import { getNotifications } from "@/lib/notifications";
import { countPaidStoreOrders } from "@/lib/store-orders/views";
import { TopbarSearch } from "@/components/TopbarSearch";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Read-only load: one retry rides out a transient database connection
  // failure (P1001 on a cold pool is the proven B-1 trigger) instead of
  // failing the whole first page load. requireUser stays outside — it can
  // touch the session write path; a retried write could land twice.
  const {
    sessionLimits,
    cashEnabled,
    payablesEnabled,
    meter,
    booksEnabled,
    settings,
  } = await withConnectionRetry(async () => {
    const sessionLimits = await currentSessionLimits();
    const { settings } = await getSettingsSnapshot();
    const [cashEnabled, payablesEnabled] = await Promise.all([isCashEnabled(), isPayablesEnabled()]);
    // Gross sales = non-voided Part 5 billing totals YTD (see src/lib/services/non-vat.ts).
    const meter = await getNonVatMeter(settings.taxYear);
    const booksEnabled = await isBooksEnabled();
    return { sessionLimits, cashEnabled, payablesEnabled, meter, booksEnabled, settings };
  });
  const milestoneMessage = NON_VAT_MESSAGES[meter.level];
  const milestoneTitle = homeNonVatTitle();
  const canOpenSettings = can(user, "manage_settings");
  const storeOrdersPaidCount = can(user, "edit_data") ? await countPaidStoreOrders() : 0;

  const sidebar = (
    <>
      <div className="brand">
        <Link href="/" className="brand-link" aria-label={`${settings.identity.appShortName} home`}>
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
        canApprove={can(user, "approve")}
        storeOrdersPaidCount={storeOrdersPaidCount}
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
    <BreadcrumbLabelProvider>
      <AppFrame
        sidebar={sidebar}
        breadcrumb={<Breadcrumb rootLabel={settings.identity.appShortName} />}
        topbarRight={topbarRight}
        initialSidebarHidden={user.sidebarHidden}
        onSidebarHiddenChange={setSidebarHiddenAction}
      >
        <IdleSignOut idleMs={sessionLimits.idleMs} signOutAction={signOut} remainingMs={idleRemainingMs} />
        {children}
      </AppFrame>
    </BreadcrumbLabelProvider>
  );
}
