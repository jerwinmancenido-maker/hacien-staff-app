import { requireUser } from "@/lib/auth/current-user";
import { formatDate, manilaHour } from "@/lib/format";
import { loadHomeDashboard } from "@/lib/home/dashboard";
import { PageHeader } from "@/components/ui";
import {
  HomeGettingStarted,
  HomeMoney,
  HomeNeedsAction,
  HomeNonVat,
  HomeRecentActivity,
  HomeTaxDeadline,
} from "@/components/home/HomeSections";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const user = await requireUser();
  const dash = await loadHomeDashboard(user);
  const first = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        greeting={`${greeting(manilaHour())}, ${first}`}
        title="Home"
        subtitle={`Today is ${formatDate(new Date())}.`}
      />

      {dash.empty && dash.gettingStarted ? (
        <HomeGettingStarted
          addCustomerHref={dash.gettingStarted.addCustomerHref}
          makeQuoteHref={dash.gettingStarted.makeQuoteHref}
        />
      ) : (
        <div className="home-dashboard">
          <HomeNeedsAction rows={dash.actions} />
          <HomeMoney rows={dash.money} />
          {dash.tax ? <HomeTaxDeadline tax={dash.tax} /> : null}
          <HomeNonVat meter={dash.nonVat} />
          <HomeRecentActivity rows={dash.recent} />
        </div>
      )}
    </>
  );
}
