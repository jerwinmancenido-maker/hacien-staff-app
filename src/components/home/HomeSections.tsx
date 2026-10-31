// Presentational Home sections (server components).

import Link from "next/link";
import { formatPeso } from "@/lib/format";
import type { HomeDashboard } from "@/lib/home/dashboard";
import { nonVatBarFillClass } from "@/lib/home/nonVatBar";
import { HOME_NON_VAT_TITLE, homeNonVatHelperLine } from "@/lib/home/nonVatCopy";
import type { NonVatLevel } from "@/lib/services/non-vat";
import { EmptyState } from "@/components/ui";

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
    <div className="card home-section">
      <div className="card-head">
        <h2>Needs action</h2>
      </div>
      <ul className="home-action-list">
        {rows.map((r) => (
          <li key={r.kind}>
            <Link className="home-action-row" href={r.href}>
              <span className="home-action-label">{r.label}</span>
              <span className="home-action-count num">{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeMoney({ rows }: { rows: HomeDashboard["money"] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card home-section">
      <div className="card-head">
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
    </div>
  );
}

export function HomeTaxDeadline({ tax }: { tax: NonNullable<HomeDashboard["tax"]> }) {
  return (
    <div className="card home-section">
      <div className="card-head">
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
    </div>
  );
}

export function HomeNonVat({ meter }: { meter: HomeDashboard["nonVat"] }) {
  const helper = homeNonVatHelperLine(meter.warnFirstPct, meter.warnSecondPct);
  return (
    <div className={`card home-section home-nonvat level-${meter.level}`}>
      <div className="card-head">
        <h2>{HOME_NON_VAT_TITLE}</h2>
        <div className="right">
          <Link className="btn-link small" href={meter.href}>
            Billing →
          </Link>
        </div>
      </div>
      <Link className="home-nonvat-link" href={meter.href}>
        <div className="home-nonvat-figures">
          <span className="num strong">{formatPeso(meter.used)}</span>
          <span className="faint small">of {formatPeso(meter.limit)}</span>
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
    </div>
  );
}

export function HomeRecentActivity({ rows }: { rows: HomeDashboard["recent"] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card home-section">
      <div className="card-head">
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
    </div>
  );
}
