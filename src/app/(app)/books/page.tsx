import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { BOOKS_DISCLAIMER, REGISTER_CONFIGS, REGISTER_KEYS } from "@/lib/books/config";
import { parseBooksPeriod } from "@/lib/books/period";
import { TAX_WORKSHEET_PAGES } from "@/lib/tax/constants";
import { TAX_CALENDAR_PAGE } from "@/lib/tax/calendar-constants";
import { formatDate } from "@/lib/format";
import { BooksBanner } from "@/components/books/BooksBanner";
import { BooksNav } from "@/components/books/BooksNav";
import { PeriodCloseCard } from "@/components/books/PeriodCloseCard";
import { PageHeader } from "@/components/ui";
import { previousYearMonth, yearMonthOf } from "@/lib/period-close-shared";
import { isPeriodCloseEnabled, listPeriodLocks } from "@/lib/services/period-close";
import { listBusinesses } from "@/lib/services/businesses";
import { getHeldForOthers } from "@/lib/services/books";
import { formatPeso } from "@/lib/format";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function BooksHomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;
  const period = parseBooksPeriod(sp.from, sp.to);
  // Phase 4 #10 (P7): the Period close card renders only when the flag
  // is on; the flag is the LAST proof step, so the card appears then.
  const periodCloseOn = await isPeriodCloseEnabled();
  const periodLocks = periodCloseOn ? await listPeriodLocks() : [];
  // Entity wall (PR-B): the held-for-others card appears only once a
  // business exists in Settings AND money actually moved for one.
  const businesses = await listBusinesses();
  const held = businesses.length ? await getHeldForOthers(user, period.fromYmd, period.toYmd) : null;
  const heldHasMoney =
    held !== null &&
    (held.billsCount > 0 || held.paymentsCount > 0 || held.expensesCount > 0 || held.stillOwed !== "0.00");

  return (
    <>
      <PageHeader
        title="Books"
        subtitle={BOOKS_DISCLAIMER}
      />
      <BooksNav active="home" />
      <BooksBanner />
      {heldHasMoney && held && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Held for other businesses</h2>
          <p style={{ marginTop: 0 }}>
            Money recorded in this app for other businesses in this period. It is <b>not</b> in HACIEN&apos;s
            registers, profit or tax figures — this card is here so the bank still adds up: bank balance =
            HACIEN&apos;s books + held for others.
          </p>
          <ul className="plain-list" style={{ paddingLeft: 18, marginBottom: 0 }}>
            <li>
              Supplier bills recorded: <b>{formatPeso(held.billsRecorded)}</b> ({held.billsCount})
            </li>
            <li>
              Supplier payments made: <b>{formatPeso(held.paymentsMade)}</b> ({held.paymentsCount})
            </li>
            <li>
              Expenses recorded: <b>{formatPeso(held.expensesRecorded)}</b> ({held.expensesCount})
            </li>
            <li>
              Still owed to suppliers for other businesses (all dates): <b>{formatPeso(held.stillOwed)}</b>
            </li>
          </ul>
        </div>
      )}
      {periodCloseOn ? (
        <PeriodCloseCard
          locks={periodLocks.map((l) => ({
            yearMonth: l.yearMonth,
            closed: l.closed,
            closedAt: l.closedAt ? l.closedAt.toISOString() : null,
            reopenedAt: l.reopenedAt ? l.reopenedAt.toISOString() : null,
            reopenReason: l.reopenReason,
          }))}
          isAdmin={user.active && user.isAdmin}
          defaultMonth={previousYearMonth(yearMonthOf(new Date()))}
        />
      ) : null}
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Build book-style registers from records you already entered. Pick a register, check the dates
          (defaults to this month in Manila time), then Print/PDF or Export CSV.
        </p>
        <p className="faint small">
          Period shown: <b>{day(period.fromYmd)}</b> – <b>{day(period.toYmd)}</b>
          {period.isDefaultMonth ? " (current month)" : ""}.
        </p>
        <ul className="plain-list" style={{ paddingLeft: 18, marginBottom: 0 }}>
          {REGISTER_KEYS.map((key) => {
            const c = REGISTER_CONFIGS[key];
            const q = `?from=${period.fromYmd}&to=${period.toYmd}`;
            return (
              <li key={key} style={{ marginBottom: 12 }}>
                <Link className="link" href={`/books/${c.path}${q}`}>
                  <b>{c.title}</b>
                </Link>
                <div className="faint small">{c.subtitle}</div>
              </li>
            );
          })}
          <li style={{ marginBottom: 12 }}>
            <Link className="link" href="/books/profit">
              <b>Monthly profit</b>
            </Link>
            <div className="faint small">Net profit for the month and margin by deal, with CSV export.</div>
          </li>
          <li style={{ marginBottom: 12 }}>
            <Link className="link" href={TAX_WORKSHEET_PAGES.home.href}>
              <b>{TAX_WORKSHEET_PAGES.home.title}</b>
            </Link>
            <div className="faint small">{TAX_WORKSHEET_PAGES.home.subtitle}</div>
          </li>
          <li style={{ marginBottom: 0 }}>
            <Link className="link" href={TAX_CALENDAR_PAGE.href}>
              <b>{TAX_CALENDAR_PAGE.title}</b>
            </Link>
            <div className="faint small">{TAX_CALENDAR_PAGE.subtitle}</div>
          </li>
        </ul>
      </div>
    </>
  );
}
