// Presentational Home sections (server components) — concept A card layout.

import Link from "next/link";
import { formatPeso, formatPesoLimit } from "@/lib/format";
import { formatHomeActionCount } from "@/lib/home/actionCount";
import type { HomeDashboard, HomeKpis } from "@/lib/home/dashboard";
import type { HomeSales } from "@/lib/home/sales";
import { EmptyState } from "@/components/ui";
import { HomeSalesChart } from "@/components/home/HomeSalesChart";
import {
  AlertTriangleIcon,
  CartIcon,
  ChevronRightIcon,
  CoinIcon,
  FileIcon,
  InboxIcon,
  UsersIcon,
} from "@/components/Icons";

export function HomeGettingStarted({
  addCustomerHref,
  makeQuoteHref,
}: {
  addCustomerHref: string;
  makeQuoteHref: string;
}) {
  return (
    <div className="card home-getting-started">
      <EmptyState title="Welcome — let's get started" line="Add a customer, then make a quote." />
      <div className="home-getting-started-actions">
        <Link className="btn" href={addCustomerHref}>
          Add a customer
        </Link>
        <Link className="btn btn-secondary" href={makeQuoteHref}>
          Make a quote
        </Link>
      </div>
    </div>
  );
}

function ChangeChip({ change }: { change: HomeKpis["billedThisMonth"]["change"] }) {
  if (change.tone === "none") {
    return <span className="home-change-none">{change.label}</span>;
  }
  if (change.tone === "up") {
    return (
      <span className="home-chip home-chip-up">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 17L17 7M9 7h8v8" />
        </svg>
        {change.label}
      </span>
    );
  }
  if (change.tone === "down") {
    return (
      <span className="home-chip home-chip-down">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 7l10 10M9 17h8v-8" />
        </svg>
        {change.label}
      </span>
    );
  }
  return <span className="home-chip home-chip-muted">{change.label}</span>;
}

export function HomeKpiCards({ kpis }: { kpis: HomeKpis }) {
  return (
    <div className="home-kps">
      <div className="card home-kp">
        <div className="home-kl">
          <CoinIcon size={15} />
          Billed this month
        </div>
        <div className="home-kv num">{formatPeso(kpis.billedThisMonth.amount)}</div>
        <div className="home-ks">
          <ChangeChip change={kpis.billedThisMonth.change} />
          <span>{kpis.billedThisMonth.vsCaption}</span>
        </div>
      </div>

      <div className="card home-kp">
        <div className="home-kl">
          <InboxIcon size={15} />
          Owed by customers
        </div>
        <div className="home-kv num">{formatPeso(kpis.owedByCustomers.amount)}</div>
        <div className="home-ks">
          {kpis.owedByCustomers.overdueChip ? (
            <span className="home-chip home-chip-overdue">{kpis.owedByCustomers.overdueChip.label}</span>
          ) : null}
          <span>{kpis.owedByCustomers.billingCountLabel}</span>
        </div>
      </div>

      <div className="card home-kp">
        <div className="home-kl">
          <CartIcon size={15} />
          Collected this month
        </div>
        <div className="home-kv num">{formatPeso(kpis.collectedThisMonth.amount)}</div>
        <div className="home-ks">{kpis.collectedThisMonth.caption}</div>
      </div>

      <div className="card home-kp">
        <div className="home-kl">
          <FileIcon size={15} />
          Billed this year
        </div>
        <div className="home-kv num">{formatPeso(kpis.billedThisYear.amount)}</div>
        <div className="home-ks home-ks-bar">
          <span className="home-mini-bar" aria-hidden>
            <i style={{ width: `${Math.min(100, Math.max(0, kpis.billedThisYear.barPct))}%` }} />
          </span>
          <b className="num">{kpis.billedThisYear.pctLabel}</b>
          <span>{kpis.billedThisYear.limitLabel}</span>
        </div>
      </div>
    </div>
  );
}

function actionIcon(kind: HomeDashboard["actions"][number]["kind"]) {
  switch (kind) {
    case "quotesNeedsApproval":
    case "quotesNoReply":
      return <FileIcon size={16} />;
    case "salesOrdersNeedsPo":
      return <CartIcon size={16} />;
    case "posAwaitingReceipt":
      return <InboxIcon size={16} />;
    case "billsOverPo":
      return <AlertTriangleIcon size={16} />;
    case "billingsOverdue":
      return <AlertTriangleIcon size={16} />;
    case "customersNoWithholding":
      return <UsersIcon size={16} />;
    default:
      return <FileIcon size={16} />;
  }
}

export function HomeNeedsAction({
  rows,
  openCount,
}: {
  rows: HomeDashboard["actions"];
  openCount: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card home-na-card">
      <div className="home-ct">
        <h3>Needs action</h3>
        <span className="home-chip home-chip-overdue">{formatHomeActionCount(openCount)} open</span>
      </div>
      <ul className="home-na">
        {rows.map((r) => {
          const overdue = r.kind === "billingsOverdue";
          return (
            <li key={r.kind}>
              <Link className="home-na-row" href={r.href}>
                <span className={`home-na-i${overdue ? " is-overdue" : ""}`}>{actionIcon(r.kind)}</span>
                <span className="home-na-t">{r.label}</span>
                <span className={`home-na-c num${overdue ? " is-overdue" : ""}`}>
                  {formatHomeActionCount(r.count)}
                </span>
                <ChevronRightIcon size={14} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HomeSalesSection({ sales }: { sales: HomeSales }) {
  return (
    <div className="card home-sales">
      <div className="home-ct">
        <div>
          <h3>Sales billed</h3>
          <div className="home-sales-sub muted">
            Last 12 months{sales.rangeLabel ? ` · ${sales.rangeLabel}` : ""}
          </div>
        </div>
        <Link className="home-lk" href={sales.href}>
          Billing →
        </Link>
      </div>

      <HomeSalesChart sales={sales} />

      {sales.empty ? (
        <div className="home-sales-empty">
          <p className="home-sales-empty-copy">No sales billed yet</p>
          <p className="home-sales-empty-copy muted">Billings you issue will show here.</p>
          <Link className="btn" href={sales.href}>
            Go to Billing
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function HomeTaxDeadline({ tax }: { tax: NonNullable<HomeDashboard["tax"]> }) {
  return (
    <Link className="card home-tax" href={tax.href}>
      {tax.badgeMonth && tax.badgeDay ? (
        <div className="home-db" aria-hidden>
          <div>{tax.badgeMonth}</div>
          <b>{tax.badgeDay}</b>
        </div>
      ) : null}
      <div className="home-tax-body">
        <div className="home-tax-kicker muted">Next tax deadline</div>
        <div className="home-tax-form">{tax.form}</div>
        <div className="muted small">{tax.description}</div>
        <div className="muted small">{tax.dueDetail}</div>
        {tax.overdueUnfiledCount > 0 ? (
          <div className="home-tax-overdue small">
            {tax.overdueUnfiledCount} overdue {tax.overdueUnfiledCount === 1 ? "item" : "items"} not marked filed
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function activityIcon(entityType: string) {
  switch (entityType) {
    case "Quote":
      return <FileIcon size={14} />;
    case "SalesOrder":
      return <CartIcon size={14} />;
    case "Billing":
    case "Collection":
      return <CoinIcon size={14} />;
    case "Customer":
      return <UsersIcon size={14} />;
    default:
      return <FileIcon size={14} />;
  }
}

export function HomeRecentActivity({
  rows,
  auditHref,
}: {
  rows: HomeDashboard["recent"];
  auditHref: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card home-activity-card">
      <div className="home-ct">
        <h3>Recent activity</h3>
        <Link className="home-lk" href={auditHref}>
          Audit log →
        </Link>
      </div>
      <div className="home-ra">
        {rows.map((r) => {
          const inner = (
            <>
              <span className="home-ri">{activityIcon(r.entityType)}</span>
              <div className="home-ra-main">
                <div className="home-ra-summary">{r.summary}</div>
                {r.detail ? <div className="muted small">{r.detail}</div> : null}
              </div>
              <span className="home-ra-when muted small">{r.atLabel}</span>
            </>
          );
          return r.href ? (
            <Link key={r.id} className="home-ra-row" href={r.href}>
              {inner}
            </Link>
          ) : (
            <div key={r.id} className="home-ra-row">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** @deprecated Money folded into KPI cards (concept A). Kept for any leftover imports. */
export function HomeMoney({ rows }: { rows: HomeDashboard["money"] }) {
  if (rows.length === 0) return null;
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h2>Money</h2>
      </div>
      <ul className="home-money-list">
        {rows.map((r) => (
          <li key={r.kind}>
            <Link className="home-money-row" href={r.href}>
              <span className="home-money-label">{r.label}</span>
              <span className="home-money-amounts">
                <span className="num strong">{formatPeso(r.amount)}</span>
                {r.showOverdueRed && r.overdueAmount && Number(r.overdueAmount) > 0 ? (
                  <span className="home-money-overdue num">{formatPeso(r.overdueAmount)} overdue</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** @deprecated Non-VAT lives in the year KPI + sidebar meter. */
export function HomeNonVat({ meter }: { meter: HomeDashboard["nonVat"] }) {
  return (
    <section className={`home-section home-nonvat level-${meter.level}`}>
      <div className="home-section-head">
        <h2>Non-VAT sales limit ({formatPesoLimit(meter.limit)})</h2>
      </div>
      <div className="home-nonvat-figures">
        <span className="num strong">{formatPeso(meter.used)}</span>
        <span className="faint small">of {formatPesoLimit(meter.limit)}</span>
        <span className="num home-nonvat-pct">{meter.pctLabel}</span>
      </div>
    </section>
  );
}
