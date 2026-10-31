// Presentational Home sections (server components).

import Link from "next/link";
import { formatPeso, formatPesoLimit } from "@/lib/format";
import { formatHomeActionCount } from "@/lib/home/actionCount";
import type { HomeDashboard } from "@/lib/home/dashboard";
import type { HomeSales } from "@/lib/home/sales";
import { nonVatBarFillClass } from "@/lib/home/nonVatBar";
import { homeNonVatHelperLine, homeNonVatTitle } from "@/lib/home/nonVatCopy";
import type { NonVatLevel } from "@/lib/services/non-vat";
import { EmptyState } from "@/components/ui";
import { HomeSalesChart } from "@/components/home/HomeSalesChart";

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

export function HomeNeedsAction({ rows }: { rows: HomeDashboard["actions"] }) {
  if (rows.length === 0) return null;
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h2>Needs action</h2>
      </div>
      <ul className="home-action-list">
        {rows.map((r) => (
          <li key={r.kind}>
            <Link className="home-action-row" href={r.href}>
              <span className="home-action-label">{r.label}</span>
              <span className="home-action-count num">{formatHomeActionCount(r.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeSalesSection({ sales }: { sales: HomeSales }) {
  return (
    <section className="home-section home-sales">
      <div className="home-section-head">
        <h2>Sales</h2>
        <div className="right">
          <Link className="btn-link small" href={sales.href}>
            Billing →
          </Link>
        </div>
      </div>

      <HomeSalesChart sales={sales} />

      {sales.empty ? (
        <div className="home-sales-empty">
          <p className="home-sales-empty-copy">
            No sales billed yet. Billings you issue will show here.
          </p>
          <Link className="btn" href={sales.href}>
            Go to Billing
          </Link>
        </div>
      ) : (
        <ul className="home-money-list home-sales-rows">
          <li>
            <div className="home-money-row home-sales-stat">
              <span className="home-money-label">Billed this month</span>
              <span className="home-money-amounts">
                <span className="num strong">{formatPeso(sales.thisMonth)}</span>
              </span>
            </div>
          </li>
          <li>
            <div className="home-money-row home-sales-stat">
              <span className="home-money-label">Billed last month</span>
              <span className="home-money-amounts">
                <span className="num strong">{formatPeso(sales.lastMonth)}</span>
              </span>
            </div>
          </li>
          <li>
            <div className="home-money-row home-sales-stat">
              <span className="home-money-label">Change vs last month</span>
              <span className="home-money-amounts">
                <span className={`num strong home-sales-change tone-${sales.change.tone}`}>
                  {sales.change.label}
                </span>
              </span>
            </div>
          </li>
          <li>
            <div className="home-money-row home-sales-stat">
              <span className="home-money-label">Billed this year</span>
              <span className="home-money-amounts">
                <span className="num strong">{formatPeso(sales.thisYear)}</span>
              </span>
            </div>
          </li>
          {sales.topCustomers.length > 0 ? (
            <li className="home-sales-top-block">
              <div className="home-sales-top-label">Top customers this year</div>
              <ul className="home-sales-top-list">
                {sales.topCustomers.map((c) => (
                  <li key={c.customerId}>
                    <Link className="home-money-row" href={c.href}>
                      <span className="home-money-label">{c.name}</span>
                      <span className="home-money-amounts">
                        <span className="num strong">{formatPeso(c.amount)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

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
                  <span className="home-money-overdue num">
                    {formatPeso(r.overdueAmount)} overdue
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeTaxDeadline({ tax }: { tax: NonNullable<HomeDashboard["tax"]> }) {
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h2>Next tax deadline</h2>
        <div className="right">
          <Link className="btn-link small" href={tax.href}>
            Tax calendar →
          </Link>
        </div>
      </div>
      <Link className="home-tax-link" href={tax.href}>
        <div className="home-tax-main">
          <div className="strong">{tax.form}</div>
          <div className="muted small">{tax.description}</div>
        </div>
        <div className="home-tax-due">
          <div className="label">Due</div>
          <div className="num strong">{tax.dueLabel}</div>
        </div>
      </Link>
      {tax.overdueUnfiledCount > 0 ? (
        <div className="home-tax-overdue small">
          <Link href={tax.href}>
            {tax.overdueUnfiledCount} overdue {tax.overdueUnfiledCount === 1 ? "item" : "items"} not marked filed →
          </Link>
        </div>
      ) : null}
    </section>
  );
}

export function HomeNonVat({ meter }: { meter: HomeDashboard["nonVat"] }) {
  const helper = homeNonVatHelperLine(meter.warnFirstPct, meter.warnSecondPct);
  return (
    <section className={`home-section home-nonvat level-${meter.level}`}>
      <div className="home-section-head">
        <h2>{homeNonVatTitle(meter.limit)}</h2>
        <div className="right">
          <Link className="btn-link small" href={meter.href}>
            Billing →
          </Link>
        </div>
      </div>
      <Link className="home-nonvat-link" href={meter.href}>
        <div className="home-nonvat-figures">
          <span className="num strong">{formatPeso(meter.used)}</span>
          <span className="faint small">of {formatPesoLimit(meter.limit)}</span>
          <span className="num home-nonvat-pct">{meter.pctLabel}</span>
        </div>
        <div
          className="aging-bar-track"
          role="meter"
          aria-label="Share of the non-VAT limit used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(meter.barPct)}
        >
          <div
            className={`aging-bar-fill${nonVatBarFillClass(meter.level as NonVatLevel)}`}
            style={{ width: `${meter.barPct}%` }}
          />
        </div>
        <p className="home-nonvat-helper faint small">{helper}</p>
        {meter.warning ? <div className="home-nonvat-warn small">{meter.warning}</div> : null}
      </Link>
    </section>
  );
}

export function HomeRecentActivity({ rows }: { rows: HomeDashboard["recent"] }) {
  if (rows.length === 0) return null;
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h2>Recent activity</h2>
      </div>
      <ul className="home-activity-list">
        {rows.map((r) => (
          <li key={r.id}>
            {r.href ? (
              <Link className="home-activity-row" href={r.href}>
                <span className="home-activity-summary">{r.summary}</span>
                <span className="home-activity-when faint small">{r.atLabel}</span>
              </Link>
            ) : (
              <div className="home-activity-row">
                <span className="home-activity-summary">{r.summary}</span>
                <span className="home-activity-when faint small">{r.atLabel}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
