import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDate, manilaHour } from "@/lib/format";
import { PageHeader } from "@/components/ui";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const user = await requireUser();
  const [customers, suppliers, contacts] = await Promise.all([
    db.customer.count({ where: { active: true } }),
    db.supplier.count({ where: { active: true } }),
    db.contact.count({ where: { active: true } }),
  ]);
  const first = user.name.split(" ")[0];
  return (
    <>
      <PageHeader
        greeting={`${greeting(manilaHour())}, ${first} 👋`}
        title="Home"
        subtitle={`Today is ${formatDate(new Date())}. Deals, cash gap and overdue bills will show here once quotes and sales orders are built.`}
      />
      <div className="stat-grid">
        <Link href="/customers" className="card stat">
          <div className="label">Active customers</div>
          <div className="value">{customers}</div>
          <div className="foot">Open the customer list →</div>
        </Link>
        <Link href="/suppliers" className="card stat">
          <div className="label">Active suppliers</div>
          <div className="value">{suppliers}</div>
          <div className="foot">Open the supplier list →</div>
        </Link>
        <div className="card stat">
          <div className="label">Active contacts</div>
          <div className="value">{contacts}</div>
          <div className="foot">Across customers and suppliers</div>
        </div>
      </div>
      <div className="card">
        <h2>Coming next</h2>
        <div className="muted">Quotes, Sales Orders, Supplier POs, Billing &amp; Collections and Books are on the way.</div>
      </div>
    </>
  );
}
