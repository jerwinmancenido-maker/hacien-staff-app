import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { booksDisclaimer, isRegisterKey, REGISTER_CONFIGS } from "@/lib/books/config";
import { getSettingsSnapshot } from "@/lib/settings";
import { parseBooksPeriod } from "@/lib/books/period";
import { getBookRegister } from "@/lib/services/books";
import { pagingWindow, parsePageParam } from "@/lib/paging";
import { BooksBanner } from "@/components/books/BooksBanner";
import { BooksNav, type BooksTab } from "@/components/books/BooksNav";
import { BooksPeriodFilters } from "@/components/books/BooksPeriodFilters";
import { BooksRegisterTable } from "@/components/books/BooksRegisterTable";
import { PageHeader } from "@/components/ui";

export default async function BooksRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ register: string }>;
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const { settings } = await getSettingsSnapshot();
  const { register: raw } = await params;
  if (!isRegisterKey(raw)) notFound();
  const config = REGISTER_CONFIGS[raw];
  const sp = await searchParams;
  const period = parseBooksPeriod(sp.from, sp.to);
  const { register } = await getBookRegister(user, raw, period.fromYmd, period.toYmd);
  const q = `from=${period.fromYmd}&to=${period.toYmd}`;
  // F-1 (finding 1354): page the rendered rows with the shared list paging
  // (src/lib/paging + ListPager, the same mechanism as the big list pages).
  // buildRegister's totals and rowCount stay computed over the FULL period;
  // only the rows handed to the table are sliced to the requested page.
  const win = pagingWindow(register.rowCount, parsePageParam(sp.page));
  const pagedRegister = { ...register, rows: register.rows.slice(win.skip, win.skip + win.take) };

  return (
    <>
      <PageHeader title={config.title} subtitle={`${config.subtitle} · ${booksDisclaimer(settings.identity.appShortName, settings.taxYear.isVatRegistered)}`} />
      <BooksNav active={raw as BooksTab} />
      <BooksBanner />
      <div className="card">
        <BooksPeriodFilters
          basePath={`/books/${config.path}`}
          from={period.fromYmd}
          to={period.toYmd}
          exportHref={`/books/${config.path}/export?${q}`}
          printHref={`/print/books/${config.path}?${q}`}
        />
        <BooksRegisterTable
          config={config}
          register={pagedRegister}
          pager={{
            page: win.page,
            totalPages: win.totalPages,
            total: register.rowCount,
            noun: "rows",
            hrefFor: (p) => `/books/${config.path}?${q}&page=${p}`,
            jumpAction: `/books/${config.path}`,
            jumpParams: { from: period.fromYmd, to: period.toYmd },
          }}
        />
      </div>
    </>
  );
}
