import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDate, formatPeso, manilaHour } from "@/lib/format";
import { canSeeCosts } from "@/lib/permissions";
import { isCashEnabled } from "@/lib/cash/features";
import { cashPositionSummary } from "@/lib/services/cash-accounts";
import { purchasingStats } from "@/lib/purchasing/views";
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
  const po = await purchasingStats();
  const withCosts = canSeeCosts(user);
  const cashOn = await isCashEnabled();
  const cash = cashOn ? await cashPositionSummary() : null;
  const first = user.name.split(" ")[0];
  return (
    <>
      <PageHeader
        greeting={`${greeting(manilaHour())}, ${first} 👋`}
        title="Home"
        subtitle={`Today is ${formatDate(new Date())}.`}
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
        {withCosts && (
          <Link href="/purchase-orders" className="card stat">
            <div className="label">Open supplier POs</div>
            <div className="value">{po.openPos}</div>
            <div className="foot">{formatPeso(po.openPosTotal)} · approved, sent or partly received</div>
          </Link>
        )}
        <Link href="/receiving" className="card stat">
          <div className="label">Awaiting receipt</div>
          <div className="value">{po.awaitingReceipt}</div>
          <div className="foot">POs sent to suppliers, not fully received →</div>
        </Link>
        {cash && (
          <Link href="/cash" className="card stat">
            <div className="label">Cash position</div>
            <div className="value num">{formatPeso(cash.total)}</div>
            <div className="foot">
              {cash.accounts.length === 0
                ? "Add a bank account →"
                : cash.accounts
                    .slice(0, 2)
                    .map((a) => `${a.name} ${formatPeso(a.balance)}`)
                    .join(" · ") + (cash.accounts.length > 2 ? "…" : "")}
            </div>
          </Link>
        )}
        <div className="card stat">
          <div className="label">Active contacts</div>
          <div className="value">{contacts}</div>
          <div className="foot">Across customers and suppliers</div>
        </div>
      </div>
    </>
  );
}
