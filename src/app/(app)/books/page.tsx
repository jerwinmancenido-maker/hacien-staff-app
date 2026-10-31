import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { BOOKS_DISCLAIMER, REGISTER_CONFIGS, REGISTER_KEYS } from "@/lib/books/config";
import { parseBooksPeriod } from "@/lib/books/period";
import { TAX_WORKSHEET_PAGES } from "@/lib/tax/constants";
import { TAX_CALENDAR_PAGE } from "@/lib/tax/calendar-constants";
import { formatDate } from "@/lib/format";
import { BooksBanner } from "@/components/books/BooksBanner";
import { BooksNav } from "@/components/books/BooksNav";
import { PageHeader } from "@/components/ui";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function BooksHomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePagePermission("view_books");
  const sp = await searchParams;
  const period = parseBooksPeriod(sp.from, sp.to);

  return (
    <>
      <PageHeader
        title="Books"
        subtitle={BOOKS_DISCLAIMER}
      />
      <BooksNav active="home" />
      <BooksBanner />
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
                <Link href={`/books/${c.path}${q}`}>
                  <b>{c.title}</b>
                </Link>
                <div className="faint small">{c.subtitle}</div>
              </li>
            );
          })}
          <li style={{ marginBottom: 12 }}>
            <Link href={TAX_WORKSHEET_PAGES.home.href}>
              <b>{TAX_WORKSHEET_PAGES.home.title}</b>
            </Link>
            <div className="faint small">{TAX_WORKSHEET_PAGES.home.subtitle}</div>
          </li>
          <li style={{ marginBottom: 0 }}>
            <Link href={TAX_CALENDAR_PAGE.href}>
              <b>{TAX_CALENDAR_PAGE.title}</b>
            </Link>
            <div className="faint small">{TAX_CALENDAR_PAGE.subtitle}</div>
          </li>
        </ul>
      </div>
    </>
  );
}
