import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { BOOKS_DISCLAIMER, isRegisterKey, REGISTER_CONFIGS } from "@/lib/books/config";
import { parseBooksPeriod } from "@/lib/books/period";
import { getBookRegister } from "@/lib/services/books";
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
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const { register: raw } = await params;
  if (!isRegisterKey(raw)) notFound();
  const config = REGISTER_CONFIGS[raw];
  const sp = await searchParams;
  const period = parseBooksPeriod(sp.from, sp.to);
  const { register } = await getBookRegister(user, raw, period.fromYmd, period.toYmd);
  const q = `from=${period.fromYmd}&to=${period.toYmd}`;

  return (
    <>
      <PageHeader title={config.title} subtitle={`${config.subtitle} · ${BOOKS_DISCLAIMER}`} />
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
        <BooksRegisterTable config={config} register={register} />
      </div>
    </>
  );
}
