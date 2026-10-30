import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { TAX_WORKSHEET_DISCLAIMER, TAX_WORKSHEET_PAGES } from "@/lib/tax/constants";
import { parseTaxQuarter } from "@/lib/tax/quarters";
import { BooksNav } from "@/components/books/BooksNav";
import { TaxNav } from "@/components/books/TaxNav";
import { TaxWorksheetBanner } from "@/components/books/TaxWorksheetBanner";
import { PageHeader } from "@/components/ui";

const PAGES = [
  TAX_WORKSHEET_PAGES.income,
  TAX_WORKSHEET_PAGES.received2307,
  TAX_WORKSHEET_PAGES.supplierEwt,
  TAX_WORKSHEET_PAGES.salesSummary,
] as const;

export default async function TaxWorksheetsHomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  await requirePagePermission("view_books");
  const sp = await searchParams;
  const period = parseTaxQuarter(sp.year, sp.quarter);
  const q = `year=${period.year}&quarter=${period.quarter}`;

  return (
    <>
      <PageHeader title={TAX_WORKSHEET_PAGES.home.title} subtitle={TAX_WORKSHEET_DISCLAIMER} />
      <BooksNav active="tax" />
      <TaxNav active="home" />
      <TaxWorksheetBanner />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Worksheets help the owner and accountant prepare returns. Pick a worksheet, check the year and
          quarter (defaults to the latest finished quarter), then Print/PDF or Export CSV.
        </p>
        <p className="faint small">
          Default period: <b>{period.label}</b>
          {period.isDefault ? " (latest finished quarter)" : ""}.
        </p>
        <ul className="plain-list" style={{ paddingLeft: 18, marginBottom: 0 }}>
          {PAGES.map((p) => (
            <li key={p.key} style={{ marginBottom: 12 }}>
              <Link href={`${p.href}?${q}`}>
                <b>{p.title}</b>
              </Link>
              <div className="faint small">{p.subtitle}</div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
