import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import {
  ALLOWANCE_8PCT_LABEL,
  COLLECTED_REFERENCE_HINT,
  COLLECTED_TOTAL_LABEL,
  INCOME_TAX_LINE_HINTS,
  INVOICED_TOTAL_LABEL,
  OVER_THRESHOLD_WARNING,
  TAX_BASIS_UNVERIFIED_NOTE,
  TAX_WORKSHEET_DISCLAIMER,
  TAX_WORKSHEET_PAGES,
} from "@/lib/tax/constants";
import { parseTaxQuarter } from "@/lib/tax/quarters";
import { getIncomeTaxWorksheet } from "@/lib/services/tax-worksheets";
import { formatPeso } from "@/lib/format";
import { BooksNav } from "@/components/books/BooksNav";
import { TaxNav } from "@/components/books/TaxNav";
import { TaxQuarterFilters } from "@/components/books/TaxQuarterFilters";
import { TaxWorksheetBanner } from "@/components/books/TaxWorksheetBanner";
import { TaxPaidForm } from "@/components/books/TaxPaidForm";
import { EmptyState, PageHeader } from "@/components/ui";

function DualLine({
  letter,
  label,
  hint,
  invoiced,
  collected,
  invoicedHref,
  collectedHref,
  warnInvoiced,
  warnCollected,
}: {
  letter: string;
  label: string;
  hint: string;
  invoiced: string;
  collected: string;
  invoicedHref?: string;
  collectedHref?: string;
  warnInvoiced?: boolean;
  warnCollected?: boolean;
}) {
  const cell = (amount: string, href: string | undefined, warn?: boolean) => {
    const peso = formatPeso(amount);
    if (href) {
      return (
        <Link href={href} className={warn ? "error" : undefined}>
          {peso}
        </Link>
      );
    }
    return <span className={warn ? "error" : undefined}>{peso}</span>;
  };
  return (
    <tr>
      <td style={{ width: 28 }}>
        <b>({letter})</b>
      </td>
      <td>
        <div>{label}</div>
        <div className="faint small">{hint}</div>
      </td>
      <td className="num tax-income-main" style={{ whiteSpace: "nowrap", fontWeight: 600, fontSize: "1.05em" }}>
        {cell(invoiced, invoicedHref, warnInvoiced)}
      </td>
      <td className="num tax-income-ref" style={{ whiteSpace: "nowrap", fontSize: "0.9em", opacity: 0.75 }}>
        {cell(collected, collectedHref, warnCollected)}
      </td>
    </tr>
  );
}

export default async function IncomeTaxWorksheetPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;
  const period = parseTaxQuarter(sp.year, sp.quarter);
  const sheet = await getIncomeTaxWorksheet(user, period.year, period.quarter);
  const { invoiced, collected, bounds } = sheet;
  const q = `year=${period.year}&quarter=${period.quarter}`;
  const salesHref = `/books/sales?from=${bounds.yearStartYmd}&to=${bounds.toYmd}`;
  const collectionsHref = `/billing/collections`;
  const ewtHref = `/books/tax/2307-received?${q}`;
  const empty =
    sheet.invoicedTotal === "0.00" &&
    sheet.collectedTotal === "0.00" &&
    invoiced.f === "0.00" &&
    invoiced.e === "0.00";

  return (
    <>
      <PageHeader title={TAX_WORKSHEET_PAGES.income.title} subtitle={TAX_WORKSHEET_DISCLAIMER} />
      <BooksNav active="tax" />
      <TaxNav active="income" />
      <TaxWorksheetBanner />
      <div className="card">
        <TaxQuarterFilters
          basePath="/books/tax/income"
          year={period.year}
          quarter={period.quarter}
          exportHref={`/books/tax/income/export?${q}`}
          printHref={`/print/books/tax/income?${q}`}
        />
        {period.isDefault ? (
          <p className="faint small">Showing the latest finished quarter ({bounds.label}).</p>
        ) : null}

        <div className="alert warn" role="status" style={{ marginBottom: 16 }}>
          <b>{TAX_BASIS_UNVERIFIED_NOTE}</b>
          <div className="small" style={{ marginTop: 4 }}>
            {INCOME_TAX_LINE_HINTS.a}. The 8% math is unchanged; Collected is kept only as a reference
            column.
          </div>
        </div>

        {sheet.overThreshold ? (
          <div className="alert error" role="alert" style={{ marginBottom: 16 }}>
            <b>{OVER_THRESHOLD_WARNING}</b>
          </div>
        ) : null}

        {empty ? (
          <EmptyState title="No figures yet" line={TAX_WORKSHEET_PAGES.income.empty} />
        ) : null}

        <table className="data-table tax-income-worksheet" style={{ marginTop: empty ? 16 : 0 }}>
          <thead>
            <tr>
              <th></th>
              <th>Line</th>
              <th className="num tax-income-main">{INVOICED_TOTAL_LABEL}</th>
              <th className="num tax-income-ref">
                <div>{COLLECTED_TOTAL_LABEL}</div>
                <div className="faint small" style={{ fontWeight: 400 }}>
                  {COLLECTED_REFERENCE_HINT}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <DualLine
              letter="a"
              label="Cumulative from Jan 1 to quarter end"
              hint={`${INCOME_TAX_LINE_HINTS.invoiced} · ${INCOME_TAX_LINE_HINTS.collected}`}
              invoiced={sheet.invoicedTotal}
              collected={sheet.collectedTotal}
              invoicedHref={salesHref}
              collectedHref={collectionsHref}
              warnInvoiced={invoiced.overThreshold}
              warnCollected={collected.overThreshold}
            />
            <DualLine
              letter="b"
              label={`Less allowance — ${ALLOWANCE_8PCT_LABEL}`}
              hint={INCOME_TAX_LINE_HINTS.b}
              invoiced={invoiced.b}
              collected={collected.b}
            />
            <DualLine
              letter="c"
              label="Taxable amount"
              hint={INCOME_TAX_LINE_HINTS.c}
              invoiced={invoiced.c}
              collected={collected.c}
            />
            <DualLine
              letter="d"
              label="Income tax (8%)"
              hint={INCOME_TAX_LINE_HINTS.d}
              invoiced={invoiced.d}
              collected={collected.d}
            />
            <DualLine
              letter="e"
              label="Less tax paid in earlier quarters this year"
              hint={INCOME_TAX_LINE_HINTS.e}
              invoiced={invoiced.e}
              collected={collected.e}
            />
            <DualLine
              letter="f"
              label="Less creditable withholding (customers' 2307s / collections EWT)"
              hint={INCOME_TAX_LINE_HINTS.f}
              invoiced={invoiced.f}
              collected={collected.f}
              invoicedHref={ewtHref}
              collectedHref={ewtHref}
            />
            <DualLine
              letter="g"
              label="Payable or overpayment"
              hint={INCOME_TAX_LINE_HINTS.g}
              invoiced={invoiced.g}
              collected={collected.g}
            />
          </tbody>
        </table>

        <div style={{ marginTop: 24, borderTop: "1px solid var(--border, #ddd)", paddingTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Tax paid this quarter (manual)</h3>
          <p className="faint small" style={{ marginTop: 0 }}>
            Type what was actually paid for <b>{bounds.label}</b>. It will count on line (e) of later
            quarters in {period.year}.
          </p>
          <TaxPaidForm year={period.year} quarter={period.quarter} amountPaid={sheet.thisQuarterTaxPaid} />
          <div className="faint small" style={{ marginTop: 12 }}>
            Earlier quarters saved:{" "}
            {([1, 2, 3, 4] as const)
              .filter((qq) => qq < period.quarter)
              .map((qq) => `Q${qq} ${formatPeso(sheet.taxPaidByQuarter[qq])}`)
              .join(" · ") || "none yet"}
          </div>
        </div>
      </div>
    </>
  );
}
