import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { manilaHour, TIME_ZONE } from "@/lib/format";
import { loadHomeDashboard } from "@/lib/home/dashboard";
import { PageHeader } from "@/components/ui";
import {
  HomeGettingStarted,
  HomeKpiCards,
  HomeNeedsAction,
  HomeRecentActivity,
  HomeSalesSection,
  HomeTaxDeadline,
} from "@/components/home/HomeSections";
import { CoinIcon, FileIcon } from "@/components/Icons";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function homeDateLabel(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);
}

export default async function HomePage() {
  const user = await requireUser();
  const dash = await loadHomeDashboard(user);
  const first = user.name.split(" ")[0];
  const showSales = !!dash.sales && !!dash.kpis;
  const hasMid = showSales || dash.actions.length > 0;
  const hasBot = !!dash.tax || dash.recent.length > 0;

  const actions =
    dash.header.newQuoteHref || dash.header.newBillingHref ? (
      <div className="home-header-actions">
        {dash.header.newQuoteHref ? (
          <Link className="btn btn-secondary home-btn-quote" href={dash.header.newQuoteHref}>
            <FileIcon size={15} />
            New quote
          </Link>
        ) : null}
        {dash.header.newBillingHref ? (
          <Link className="btn home-btn-billing" href={dash.header.newBillingHref}>
            <CoinIcon size={15} />
            New billing
          </Link>
        ) : null}
      </div>
    ) : undefined;

  return (
    <>
      <PageHeader
        greeting={`${greeting(manilaHour())}, ${first} · ${homeDateLabel()}`}
        title="Home"
        actions={actions}
      />

      {dash.empty && dash.gettingStarted ? (
        <HomeGettingStarted
          addCustomerHref={dash.gettingStarted.addCustomerHref}
          makeQuoteHref={dash.gettingStarted.makeQuoteHref}
        />
      ) : (
        <div className={`home-dashboard${showSales ? " has-sales" : " is-staff"}`}>
          {showSales && dash.kpis ? <HomeKpiCards kpis={dash.kpis} /> : null}

          {hasMid ? (
            <div className={`home-mid${showSales ? "" : " home-mid-full"}`}>
              {showSales && dash.sales ? <HomeSalesSection sales={dash.sales} /> : null}
              <HomeNeedsAction rows={dash.actions} openCount={dash.openActionCount} />
            </div>
          ) : null}

          {hasBot ? (
            <div className={`home-bot${!dash.tax || dash.recent.length === 0 ? " home-bot-full" : ""}`}>
              {dash.tax ? <HomeTaxDeadline tax={dash.tax} /> : null}
              <HomeRecentActivity rows={dash.recent} auditHref={dash.auditHref} />
            </div>
          ) : null}
        </div>
      )}

      {/* Permission probe for tests — never rendered visibly. */}
      <span className="sr-only" data-can-edit={can(user, "edit_data") ? "1" : "0"} data-can-billing={can(user, "manage_billing") ? "1" : "0"} />
    </>
  );
}
