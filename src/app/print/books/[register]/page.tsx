import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import {
  BOOKS_DISCLAIMER,
  BOOKS_DRAFT_BANNER,
  isRegisterKey,
  REGISTER_CONFIGS,
} from "@/lib/books/config";
import { parseBooksPeriod } from "@/lib/books/period";
import { COLLECTED_TOTAL_LABEL, INVOICED_TOTAL_LABEL, SOURCE_LABELS } from "@/lib/books/registers";
import { getBookRegister } from "@/lib/services/books";
import { getSettingsSnapshot } from "@/lib/settings";
import { formatDate, formatPeso } from "@/lib/format";
import { PrintButton } from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ register: string }>;
}): Promise<Metadata> {
  const { register: raw } = await params;
  if (!isRegisterKey(raw)) return { title: "Books" };
  return { title: REGISTER_CONFIGS[raw].title };
}

export default async function PrintBooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ register: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) notFound();
  const { register: raw } = await params;
  if (!isRegisterKey(raw)) notFound();
  const config = REGISTER_CONFIGS[raw];
  const sp = await searchParams;
  const period = parseBooksPeriod(sp.from, sp.to);
  const { register } = await getBookRegister(user, raw, period.fromYmd, period.toYmd);
  const { settings } = await getSettingsSnapshot();
  const company = settings.company;

  // Group rows by print page for page totals.
  const pages = new Map<number, typeof register.rows>();
  for (const row of register.rows) {
    const list = pages.get(row.pageIndex) ?? [];
    list.push(row);
    pages.set(row.pageIndex, list);
  }
  const pageIndexes = [...pages.keys()].sort((a, b) => a - b);

  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/books/${config.path}?from=${period.fromYmd}&to=${period.toYmd}`}>
          Back to Books
        </Link>
        <span className="small muted">A4 · {config.title} — draft format for accountant/RDO review.</span>
        <PrintButton />
      </div>
      <div className="alert warn print-toolbar-alert no-print" role="status">
        <b>{BOOKS_DRAFT_BANNER}</b>
      </div>

      <article className="print-doc books-register-doc">
        <header className="print-header books-register-head">
          <div>
            <div className="print-brand">{company.name || "HACIEN"}</div>
            <div className="small">NON-VAT · 8% income tax option · TIN {company.tin || "—"}</div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>
              {company.address || "—"}
            </div>
          </div>
          <div className="print-doc-title">
            <h1>{config.title}</h1>
            <div className="small muted">{BOOKS_DISCLAIMER}</div>
            <div className="small">
              Period: {day(period.fromYmd)} – {day(period.toYmd)}
            </div>
            <div className="small books-draft-stamp">{BOOKS_DRAFT_BANNER}</div>
          </div>
        </header>

        {register.rowCount === 0 ? (
          <p className="faint">{config.emptyFeeds}</p>
        ) : (
          pageIndexes.map((pi) => {
            const rows = pages.get(pi)!;
            const pageTotal = register.pageTotals.find((p) => p.pageIndex === pi);
            return (
              <section key={pi} className="books-register-page">
                <table className="books-register-table">
                  <thead>
                    <tr>
                      {config.columns.map((c) => (
                        <th key={c.key} className={c.align === "right" ? "num" : undefined}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.kind}-${r.id}`}>
                        {config.columns.map((c) => {
                          let value = "";
                          switch (c.key) {
                            case "date":
                              value = day(r.date);
                              break;
                            case "documentNumber":
                              value = r.documentNumber;
                              break;
                            case "party":
                              value = r.party;
                              break;
                            case "particulars":
                              value = r.particulars;
                              break;
                            case "amount":
                              value = formatPeso(r.amount);
                              break;
                            case "ewt":
                              value = r.ewt != null && r.ewt !== "" ? formatPeso(r.ewt) : "";
                              break;
                            case "source":
                              value = SOURCE_LABELS[r.kind];
                              break;
                          }
                          return (
                            <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                              {value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="books-page-total">
                      {config.columns.map((c, i) => {
                        if (c.key === "amount") {
                          return (
                            <td key={c.key} className="num">
                              {formatPeso(pageTotal?.amountTotal ?? "0.00")}
                            </td>
                          );
                        }
                        if (c.key === "ewt") {
                          return (
                            <td key={c.key} className="num">
                              {formatPeso(pageTotal?.ewtTotal ?? "0.00")}
                            </td>
                          );
                        }
                        if (i === 0 || c.key === "particulars") {
                          return <td key={c.key}>Page {pi + 1} total</td>;
                        }
                        return <td key={c.key} />;
                      })}
                    </tr>
                  </tfoot>
                </table>
              </section>
            );
          })
        )}

        {register.rowCount > 0 && register.salesPeriodTotals && (
          <div className="books-period-total books-period-total-split">
            <div>
              <b>{INVOICED_TOTAL_LABEL}</b>
              <span className="num">{formatPeso(register.salesPeriodTotals.invoicedAmount)}</span>
              {config.columns.some((c) => c.key === "ewt") && (
                <span className="num">EWT {formatPeso(register.salesPeriodTotals.invoicedEwt)}</span>
              )}
            </div>
            <div>
              <b>{COLLECTED_TOTAL_LABEL}</b>
              <span className="num">{formatPeso(register.salesPeriodTotals.collectedAmount)}</span>
              {config.columns.some((c) => c.key === "ewt") && (
                <span className="num">EWT {formatPeso(register.salesPeriodTotals.collectedEwt)}</span>
              )}
            </div>
            <p className="small muted" style={{ margin: "8px 0 0" }}>
              Draft figures — not a tax basis; confirm with accountant/RDO.
            </p>
          </div>
        )}
        {register.rowCount > 0 && register.periodAmountTotal != null && (
          <div className="books-period-total">
            <b>Period total</b>
            <span className="num">{formatPeso(register.periodAmountTotal)}</span>
            {config.columns.some((c) => c.key === "ewt") && (
              <span className="num">EWT {formatPeso(register.periodEwtTotal ?? "0.00")}</span>
            )}
          </div>
        )}
      </article>
    </div>
  );
}
